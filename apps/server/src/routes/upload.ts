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

    let uploadUrl: string;
    let publicUrl: string;

    if (isLocal) {
      uploadUrl = getLocalUploadUrl(roomId, uniqueFileName);
      publicUrl = getLocalPublicAudioUrl(roomId, uniqueFileName);
      console.log(`Generated local URL for upload: ${uploadUrl}`);
    } else {
      const r2Key = createKey(roomId, uniqueFileName);
      uploadUrl = await generatePresignedUploadUrl(roomId, uniqueFileName, contentType);
      publicUrl = getPublicAudioUrl(roomId, uniqueFileName);
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
    const filePath = resolve(roomDir, decodeURIComponent(fileName));

    // Save the body as a file
    const arrayBuffer = await req.arrayBuffer();
    await Bun.write(filePath, arrayBuffer);

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
