import type { UploadCompleteResponseType, UploadUrlResponseType } from "@beatsync/shared";
import { GetUploadUrlSchema, UploadCompleteSchema } from "@beatsync/shared";
import { existsSync } from "fs";
import { homedir } from "os";
import type { BunServer } from "@/utils/websocket";
import {
  createKey,
  generateAudioFileName,
  generatePresignedUploadUrl,
  getPublicAudioUrl,
  validateR2Config,
} from "@/lib/r2";
import { globalManager } from "@/managers";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";
import { join } from "path";

// Local storage directory for uploaded files when R2 is not configured
const LOCAL_UPLOAD_DIR = join(homedir(), ".beatsync-local-uploads");

// Ensure local upload directory exists
async function ensureLocalUploadDir(roomId: string): Promise<string> {
  const roomDir = join(LOCAL_UPLOAD_DIR, `room-${roomId}`);
  await Bun.write(join(roomDir, ".keep"), ""); // Creates dirs recursively
  return roomDir;
}

let _ffmpegPath: string | null | undefined;

function findFfmpeg(): string | null {
  _ffmpegPath ??= (() => {
    const candidates = [
      "ffmpeg",
      "/usr/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      join(homedir(), ".local/bin/ffmpeg"),
    ];
    for (const p of candidates) {
      try {
        const result = Bun.spawnSync(["which", p.includes("/") ? p : "ffmpeg"]);
        if (result.exitCode === 0) return p;
      } catch {
        // continue
      }
      if (existsSync(p)) return p;
    }
    return null;
  })();
  return _ffmpegPath;
}

async function convertVideoToAudio(videoPath: string, audioPath: string): Promise<void> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found — cannot convert video to audio");

  const proc = Bun.spawn([ffmpeg, "-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", audioPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${proc.exitCode}`);
  }

  console.log("📼 Keeping original video for playback");
}

export function getLocalPublicAudioUrl(roomId: string, fileName: string, baseUrl: string): string {
  return `${baseUrl}/local-audio/room-${roomId}/${encodeURIComponent(fileName)}`;
}

// New endpoint to get presigned upload URL
export const handleGetPresignedURL = async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body: unknown = await req.json();
    const parseResult = GetUploadUrlSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(`Invalid request data: ${parseResult.error.message}`, 400);
    }

    const { roomId, fileName, contentType } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. Please join the room before uploading files.", 404);
    }

    const isVideo = contentType.startsWith("video/");
    const r2Validation = validateR2Config();

    if (!r2Validation.isValid) {
      // Local mode: store files on disk, serve via /local-audio/
      await ensureLocalUploadDir(roomId);
      const uniqueFileName = generateAudioFileName(fileName);
      const origin = new URL(req.url).origin;

      // Upload URL points back to this server's local PUT handler
      const uploadUrl = `${origin}/upload/local/room-${roomId}/${encodeURIComponent(uniqueFileName)}`;

      let publicUrl: string;
      let videoUrl: string | undefined;

      if (isVideo) {
        // WAV will be produced by ffmpeg; original video kept for playback
        const ext = fileName.split(".").pop() ?? "webm";
        const baseName = uniqueFileName.replace(/\.[^/.]+$/, "");
        const wavFileName = `${baseName}.wav`;
        publicUrl = getLocalPublicAudioUrl(roomId, wavFileName, origin);
        videoUrl = getLocalPublicAudioUrl(roomId, uniqueFileName.replace(/\.[^/.]+$/, `.${ext}`), origin);
      } else {
        publicUrl = getLocalPublicAudioUrl(roomId, uniqueFileName, origin);
      }

      console.log(`[Local mode] Generated upload URL: ${uploadUrl}`);

      const response: UploadUrlResponseType = { uploadUrl, publicUrl, ...(videoUrl ? { videoUrl } : {}) };
      return jsonResponse(response);
    }

    // R2 mode
    const uniqueFileName = generateAudioFileName(fileName);
    const r2Key = createKey(roomId, uniqueFileName);
    const uploadUrl = await generatePresignedUploadUrl(roomId, uniqueFileName, contentType);
    const publicUrl = getPublicAudioUrl(roomId, uniqueFileName);

    let videoUrl: string | undefined;
    if (isVideo) {
      // In R2 mode with video, videoUrl is the same file (client uploaded video, audio extracted server-side)
      videoUrl = publicUrl;
    }

    console.log(`Generated presigned URL for upload - R2 key: (${r2Key})`);

    const response: UploadUrlResponseType = { uploadUrl, publicUrl, ...(videoUrl ? { videoUrl } : {}) };
    return jsonResponse(response);
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return errorResponse("Failed to generate upload URL", 500);
  }
};

// Local file PUT handler — receives raw file bytes and stores them
export const handleLocalUpload = async (req: Request, roomId: string, fileName: string) => {
  if (req.method !== "PUT") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const roomDir = await ensureLocalUploadDir(roomId);
    const decodedFileName = decodeURIComponent(fileName);
    const filePath = join(roomDir, decodedFileName);

    const bytes = await req.arrayBuffer();
    await Bun.write(filePath, bytes);

    const contentType = req.headers.get("Content-Type") ?? "";
    const isVideo = contentType.startsWith("video/");

    if (isVideo) {
      // Convert video to WAV for audio playback
      const baseName = decodedFileName.replace(/\.[^/.]+$/, "");
      const wavPath = join(roomDir, `${baseName}.wav`);
      try {
        await convertVideoToAudio(filePath, wavPath);
        console.log(`✅ Video converted to WAV: ${wavPath}`);
      } catch (err) {
        console.error("Video-to-audio conversion failed:", err);
        // Non-fatal: client will use video's own audio track
      }
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Local upload error:", error);
    return errorResponse("Failed to save uploaded file", 500);
  }
};

// Endpoint to confirm successful upload and broadcast to room
export const handleUploadComplete = async (req: Request, server: BunServer) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body: unknown = await req.json();
    const parseResult = UploadCompleteSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(`Invalid request data: ${parseResult.error.message}`, 400);
    }

    const { roomId, publicUrl, videoUrl } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. The room may have been closed during upload.", 404);
    }

    const sources = room.addAudioSource({ url: publicUrl, ...(videoUrl ? { videoUrl } : {}) });

    console.log(`✅ Audio upload completed - broadcasting to room ${roomId} new sources: ${JSON.stringify(sources)}`);

    // Broadcast to room that new audio is available
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });

    const response: UploadCompleteResponseType = { success: true };
    return jsonResponse(response);
  } catch (error) {
    console.error("Error confirming upload:", error);
    return errorResponse("Failed to confirm upload", 500);
  }
};
