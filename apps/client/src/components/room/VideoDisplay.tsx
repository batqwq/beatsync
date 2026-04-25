"use client";

import { useGlobalStore } from "@/store/global";
import { useEffect, useRef, useState } from "react";

export const VideoDisplay = () => {
  const getSelectedTrack = useGlobalStore((state) => state.getSelectedTrack);
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const getCurrentTrackPosition = useGlobalStore((state) => state.getCurrentTrackPosition);

  const videoRef = useRef<HTMLVideoElement>(null);
  const chaseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [erroredUrl, setErroredUrl] = useState<string | null>(null);

  const selectedTrack = getSelectedTrack();
  const videoUrl = selectedTrack?.source.videoUrl ?? null;

  // Clear chase loop helper
  const stopChase = () => {
    if (chaseIntervalRef.current !== null) {
      clearInterval(chaseIntervalRef.current);
      chaseIntervalRef.current = null;
    }
  };

  // Sync video to audio clock while playing
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || erroredUrl === videoUrl) return;

    stopChase();

    if (isPlaying) {
      // Seed current time before starting chase
      video.currentTime = getCurrentTrackPosition();
      video.play().catch(() => {/* autoplay may be blocked — user gesture needed */});

      chaseIntervalRef.current = setInterval(() => {
        const target = getCurrentTrackPosition();
        const drift = Math.abs(video.currentTime - target);

        if (drift > 0.15) {
          // Hard seek for large drift
          video.currentTime = target;
          video.playbackRate = 1;
        } else if (drift > 0.025) {
          // Nudge playback rate for small drift
          const direction = video.currentTime < target ? 1 : -1;
          video.playbackRate = Math.max(0.95, Math.min(1.05, 1 + direction * 0.05));
        } else {
          video.playbackRate = 1;
        }
      }, 250);
    } else {
      stopChase();
      video.pause();
      video.currentTime = getCurrentTrackPosition();
      video.playbackRate = 1;
    }

    return stopChase;
  }, [isPlaying, videoUrl, getCurrentTrackPosition, erroredUrl]);

  // Reset on track change
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    stopChase();
    video.pause();
    video.currentTime = 0;
    video.playbackRate = 1;
  }, [videoUrl]);

  if (!videoUrl || erroredUrl === videoUrl) return null;

  return (
    <div className="w-full flex justify-center mb-3">
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        className="max-h-48 rounded-lg object-contain bg-black"
        onError={() => {
          console.warn("VideoDisplay: failed to load", videoUrl);
          setErroredUrl(videoUrl);
        }}
      />
    </div>
  );
};
