import type { UploadCompleteResponseType, UploadUrlResponseType } from "@beatsync/shared";
import { GetUploadUrlSchema, UploadCompleteSchema } from "@beatsync/shared";
import type { BunServer } from "@/utils/websocket";
import {
  createKey,
  generateAudioFileName,
  generatePresignedUploadUrl,
  getPublicAudioUrl,
  validateR2Config,
} from "@/lib/r2";
import { getLocalUploadUrl, getLocalPublicAudioUrl, ensureLocalUploadDir } from "@/lib/local";
import { globalManager } from "@/managers";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";
import { resolve } from "path";

// New endpoint to get presigned upload URL
export const handleGetPresignedURL = async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const isLocal = process.env.STORAGE_PROVIDER === "local";

    // Validate R2 configuration first if not local
    if (!isLocal) {
      const r2Validation = validateR2Config();
      if (!r2Validation.isValid) {
        console.error("R2 configuration errors:", r2Validation.errors);
        return errorResponse("R2 configuration not complete", 500);
      }
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

    // Generate unique filename
    const uniqueFileName = generateAudioFileName(fileName);
    // For video files, the public URL should point to the converted .wav
    const isVideo = contentType.startsWith("video/");
    const publicFileName = isVideo ? uniqueFileName.replace(/\.[^.]+$/, ".wav") : uniqueFileName;

    let uploadUrl: string;
    let publicUrl: string;

    if (isLocal) {
      // uploadUrl uses the original filename (server receives the video as-is, then converts)
      uploadUrl = getLocalUploadUrl(roomId, uniqueFileName);
      // publicUrl uses the converted filename so clients request the .wav
      publicUrl = getLocalPublicAudioUrl(roomId, publicFileName);
      console.log(`Generated local URL for upload: ${uploadUrl}` + (isVideo ? ` (video → will serve as ${publicFileName})` : ""));
    } else {
      const r2Key = createKey(roomId, uniqueFileName);
      uploadUrl = await generatePresignedUploadUrl(roomId, uniqueFileName, contentType);
      publicUrl = getPublicAudioUrl(roomId, publicFileName);
      console.log(`Generated presigned URL for upload - R2 key: (${r2Key})`);
    }

    const response: UploadUrlResponseType = {
      uploadUrl,
      publicUrl,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return errorResponse("Failed to generate upload URL", 500);
  }
};

/**
 * Video extensions that should be auto-converted to audio via ffmpeg.
 */
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".ts", ".3gp"]);

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Locate the ffmpeg executable. Checks known absolute paths first,
 * then falls back to bare "ffmpeg" (requires PATH).
 */
function findFfmpeg(): string {
  const { existsSync } = require("fs");

  // Absolute paths to check (winget, chocolatey, scoop)
  const absoluteCandidates = [
    resolve(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Links/ffmpeg.exe"),
    resolve(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin/ffmpeg.exe"),
    "C:/ProgramData/chocolatey/bin/ffmpeg.exe",
    resolve(process.env.USERPROFILE ?? "", "scoop/shims/ffmpeg.exe"),
    "C:/ffmpeg/bin/ffmpeg.exe",
  ];

  for (const candidate of absoluteCandidates) {
    if (existsSync(candidate)) {
      console.log(`[ffmpeg] Found at: ${candidate}`);
      return candidate;
    }
  }

  // Fallback: bare name, relying on PATH
  console.warn("[ffmpeg] Not found at known locations, falling back to PATH");
  return "ffmpeg";
}

let _ffmpegPath: string | null = null;
function getFfmpegPath(): string {
  if (!_ffmpegPath) _ffmpegPath = findFfmpeg();
  return _ffmpegPath;
}

/**
 * Convert a video file to WAV audio using ffmpeg.
 * Returns the path of the new .wav file on success, or null on failure.
 */
async function convertVideoToAudio(videoPath: string): Promise<string | null> {
  const wavPath = videoPath.replace(/\.[^.]+$/, ".wav");
  const ffmpeg = getFfmpegPath();
  console.log(`🎬→🎵 Converting video to audio: ${videoPath} → ${wavPath} (using ${ffmpeg})`);

  const proc = Bun.spawn([ffmpeg, "-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", wavPath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`❌ ffmpeg conversion failed (exit ${exitCode}):`, stderr);
    return null;
  }

  // Remove the original video file
  try {
    const { unlink } = await import("fs/promises");
    await unlink(videoPath);
    console.log(`🗑️ Removed original video: ${videoPath}`);
  } catch (e) {
    console.warn("Failed to remove original video file:", e);
  }

  console.log(`✅ Conversion complete: ${wavPath}`);
  return wavPath;
}

export const handleLocalUpload = async (req: Request) => {
  try {
    if (req.method !== "PUT") {
      return errorResponse("Method not allowed", 405);
    }

    const url = new URL(req.url);
    const roomId = url.searchParams.get("roomId");
    const fileName = url.searchParams.get("fileName");

    if (!roomId || !fileName) {
      return errorResponse("Missing roomId or fileName", 400);
    }

    // Ensure the room directory exists
    const roomDir = await ensureLocalUploadDir(roomId);
    const decodedFileName = decodeURIComponent(fileName);
    const filePath = resolve(roomDir, decodedFileName);

    // Save the body as a file
    const arrayBuffer = await req.arrayBuffer();
    await Bun.write(filePath, arrayBuffer);

    // Auto-convert video to audio
    const ext = getExtension(decodedFileName);
    if (VIDEO_EXTENSIONS.has(ext)) {
      const wavPath = await convertVideoToAudio(filePath);
      if (!wavPath) {
        return errorResponse("Video to audio conversion failed. Is ffmpeg installed?", 500);
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error during local file upload:", errorMsg);
    return errorResponse(`Failed to upload local file: ${errorMsg}`, 500);
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

    const { roomId, publicUrl } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. The room may have been closed during upload.", 404);
    }

    const sources = room.addAudioSource({ url: publicUrl });

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
