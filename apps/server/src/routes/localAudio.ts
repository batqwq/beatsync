import { LOCAL_UPLOAD_DIR } from "@/lib/local";
import { errorResponse } from "@/utils/responses";
import { resolve } from "path";

export const handleServeLocalAudio = async (req: Request, urlPath: string) => {
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

    const fileSize = file.size;
    const contentType = file.type || ((/\.mp4$|\.mkv$|\.webm$|\.mov$/i.exec(decodedPath)) ? "video/mp4" : "audio/mpeg");

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const headers = new Headers({
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        });

        const slice = file.slice(start, end + 1);
        return new Response(slice, { status: 206, headers });
      }
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(fileSize),
      "Access-Control-Allow-Origin": "*",
    });

    return new Response(file, { headers });
  } catch (error) {
    console.error("Error serving local audio file:", error);
    return errorResponse("Internal server error", 500);
  }
};
