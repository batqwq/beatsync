import { LOCAL_UPLOAD_DIR } from "@/lib/local";
import { errorResponse } from "@/utils/responses";
import { resolve } from "path";

export const handleServeLocalAudio = async (urlPath: string) => {
  try {
    // The path is expected to be something like /audio/local/room-123/filename.mp3
    const relativePath = urlPath.replace("/audio/local/", "");
    const decodedPath = decodeURIComponent(relativePath);

    // Simple directory traversal protection
    if (decodedPath.includes("..") || decodedPath.includes("\0")) {
      return errorResponse("Invalid file path", 400);
    }

    const filePath = resolve(LOCAL_UPLOAD_DIR, decodedPath);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return errorResponse("File not found", 404);
    }

    const headers = new Headers();
    headers.set("Content-Type", file.type || "audio/mpeg");
    // Add CORS headers so client can play it
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(file, { headers });
  } catch (error) {
    console.error("Error serving local audio file:", error);
    return errorResponse("Internal server error", 500);
  }
};
