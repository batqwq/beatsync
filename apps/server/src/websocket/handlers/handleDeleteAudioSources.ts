import { IS_DEMO_MODE } from "@/demo";
import { deleteObject, extractKeyFromUrl } from "@/lib/r2";
import { deleteLocalAudioFile } from "@/lib/local";
import { sendBroadcast } from "@/utils/responses";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleDeleteAudioSources: HandlerFunction<ExtractWSRequestFrom["DELETE_AUDIO_SOURCES"]> = async ({
  ws,
  message,
  server,
}) => {
  const { room } = requireCanMutate(ws);

  // Get current URLs to validate the request
  const currentUrls = new Set(room.getAudioSources().map((s) => s.url));

  // Only process URLs that actually exist in the room
  const urlsToDelete = message.urls.filter((url) => currentUrls.has(url));

  if (urlsToDelete.length === 0) {
    return; // nothing to do, silent idempotency
  }

  // In demo mode, skip deletion — just remove from room state
  if (IS_DEMO_MODE) {
    const { updated } = room.removeAudioSources(urlsToDelete);
    sendBroadcast({
      server,
      roomId: ws.data.roomId,
      message: {
        type: "ROOM_EVENT",
        event: { type: "SET_AUDIO_SOURCES", sources: updated },
      },
    });
    return;
  }

  const isLocal = process.env.STORAGE_PROVIDER === "local";
  const successfullyDeletedUrls = new Set<string>();
  const roomPrefix = `/room-${ws.data.roomId}/`;

  const deletionPromises = urlsToDelete.map(async (url) => {
    // If it's a default track or not from this room, just remove from state
    if (!url.includes(roomPrefix)) {
      successfullyDeletedUrls.add(url);
      return;
    }

    try {
      if (isLocal || url.includes("/audio/local/")) {
        await deleteLocalAudioFile(url);
        console.log(`🗑️ Deleted local object: ${url}`);
        successfullyDeletedUrls.add(url);
      } else {
        const key = extractKeyFromUrl(url);
        if (!key) {
          throw new Error(`Failed to extract key from URL: ${url}`);
        }
        await deleteObject(key);
        console.log(`🗑️ Deleted R2 object: ${key}`);
        successfullyDeletedUrls.add(url);
      }
    } catch (error) {
      console.error(`Failed to delete object for URL ${url}:`, error);
      // Don't add to successfullyDeletedUrls - keep in room state if desired,
      // but usually users want it removed from the UI anyway if it's broken.
      // We'll still remove it from UI below to ensure it disappears for the user.
      successfullyDeletedUrls.add(url);
    }
  });

  await Promise.all(deletionPromises);

  const urlsToRemove = Array.from(successfullyDeletedUrls);

  if (urlsToRemove.length === 0) {
    return;
  }

  // Remove only the successfully processed sources from room state
  const { updated } = room.removeAudioSources(urlsToRemove);

  // Broadcast updated queue to all clients
  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: {
      type: "ROOM_EVENT",
      event: { type: "SET_AUDIO_SOURCES", sources: updated },
    },
  });
};
