import { corsHeaders } from "@/utils/responses";
import { homedir } from "os";
import { join } from "path";

const LOCAL_UPLOAD_DIR = join(homedir(), ".beatsync-local-uploads");

export async function handleServeLocalAudio(req: Request, roomPath: string, fileName: string): Promise<Response> {
  const filePath = join(LOCAL_UPLOAD_DIR, roomPath, decodeURIComponent(fileName));

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }

  const fileSize = file.size;
  const contentType = file.type || "application/octet-stream";
  const rangeHeader = req.headers.get("Range");

  const baseHeaders = {
    ...corsHeaders,
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  };

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!match) {
      return new Response("Invalid Range", { status: 416, headers: corsHeaders });
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const slice = file.slice(start, end + 1);

    return new Response(slice, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunkSize.toString(),
      },
    });
  }

  return new Response(file, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": fileSize.toString(),
    },
  });
}
