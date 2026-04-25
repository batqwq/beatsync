import { config } from "dotenv";
import { mkdir, unlink } from "fs/promises";
import { resolve } from "path";

config();

export const LOCAL_UPLOAD_DIR = resolve(process.env.LOCAL_UPLOAD_DIR ?? "./uploads");

export async function ensureLocalUploadDir(roomId: string) {
  const roomDir = resolve(LOCAL_UPLOAD_DIR, `room-${roomId}`);
  await mkdir(roomDir, { recursive: true });
  return roomDir;
}

export function getLocalPublicAudioUrl(roomId: string, fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName);
  return `/audio/local/room-${roomId}/${encodedFileName}`;
}

export function getLocalUploadUrl(roomId: string, fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName);
  return `/upload/local?roomId=${encodeURIComponent(roomId)}&fileName=${encodedFileName}`;
}

export async function deleteLocalAudioFile(url: string) {
  try {
    const relativePath = url.replace(/.*\/audio\/local\//, "");
    if (!relativePath || relativePath === url) return;

    const decodedPath = decodeURIComponent(relativePath);
    if (decodedPath.includes("..") || decodedPath.includes("\0")) return;

    const filePath = resolve(LOCAL_UPLOAD_DIR, decodedPath);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      await unlink(filePath);
    }
  } catch (error) {
    console.error("Error deleting local audio file:", error);
    throw error;
  }
}
