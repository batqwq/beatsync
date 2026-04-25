import { getApiUrl } from "@/lib/urls";
import { useGlobalStore } from "@/store/global";
import { useEffect, useRef, useState } from "react";

const resolveUrl = (url: string) => (url.startsWith("/") ? `${getApiUrl()}${url}` : url);

export const VideoDisplay = () => {
  const audioSources = useGlobalStore((state) => state.audioSources);
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const getCurrentTrackPosition = useGlobalStore((state) => state.getCurrentTrackPosition);
  const currentTime = useGlobalStore((state) => state.currentTime);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  const currentSource = audioSources.find((as) => as.source.url === selectedAudioUrl);
  const videoUrl = currentSource?.source.videoUrl;

  // Sync play/pause and position
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (isPlaying) {
      const pos = getCurrentTrackPosition();
      // Only hard-seek if significantly out of sync
      if (Math.abs(video.currentTime - pos) > 0.5) {
        video.currentTime = pos;
      }
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = currentTime;
    }
  }, [isPlaying, currentTime]);

  // Periodic drift correction while playing
  useEffect(() => {
    if (!isPlaying || !videoUrl) return;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const pos = getCurrentTrackPosition();
      if (Math.abs(video.currentTime - pos) > 1.0) {
        video.currentTime = pos;
      }
    }, 2000);
    return () => clearInterval(id);
  }, [isPlaying, videoUrl, getCurrentTrackPosition]);

  if (!videoUrl) return null;

  return (
    <div
      className={`fixed bottom-24 left-4 z-50 rounded-xl overflow-hidden shadow-2xl border border-neutral-700/50 bg-black transition-all duration-200 ${
        isMinimized ? "w-16 h-9" : "w-56 h-32"
      }`}
    >
      <video ref={videoRef} src={resolveUrl(videoUrl)} muted playsInline className="w-full h-full object-contain" />
      <button
        onClick={() => setIsMinimized((m) => !m)}
        className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors"
      >
        {isMinimized ? "▲" : "▼"}
      </button>
    </div>
  );
};
