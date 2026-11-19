import { useEffect, useRef, useState } from 'react';
import type { ResolvedMarketingVideo } from './marketingVideo.config';
import {
  trackMarketingVideo,
  watchedPercentage,
} from './marketingVideo.analytics';

const MILESTONES = [25, 50, 75, 100] as const;

export function useVideoPlayback(media: ResolvedMarketingVideo) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);
  const reportedError = useRef(false);
  const milestones = useRef(new Set<number>());
  const [activated, setActivated] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [inView, setInView] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  const syncTime = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    setDuration(
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null
    );
  };

  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    const pauseWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        video?.pause();
      }
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(entries => {
            const entry = entries[0];
            const inFullscreen =
              document.fullscreenElement === video ||
              document.fullscreenElement === frame;
            if (entry !== undefined) {
              setInView(entry.isIntersecting);
              if (!entry.isIntersecting && !inFullscreen) {
                video?.pause();
              }
            }
          });
    if (frame) {
      observer?.observe(frame);
    }
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      video?.pause();
    };
  }, []);

  const reportError = () => {
    setHasError(true);
    setCurrentTime(0);
    setDuration(null);
    if (!reportedError.current) {
      reportedError.current = true;
      trackMarketingVideo('marketing_video_error', media, {
        error_code: videoRef.current?.error?.code ?? 0,
      });
    }
  };

  const requestPlay = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    setActivated(true);
    setHasError(false);
    reportedError.current = false;
    // Attach the source and request playback synchronously inside the trusted click. This keeps
    // iOS's user activation and avoids fetching media before the visitor asks to watch it.
    if (!video.getAttribute('src')) {
      video.src = media.asset.src;
    }
    if (video.error) {
      video.load();
    }
    void video
      .play()
      .then(() => video.focus())
      .catch((error: unknown) => {
        // Leaving the viewport or route can deliberately interrupt a pending play request.
        // A cancelled request is a pause, not a failed film or a failed viewing attempt.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        reportError();
      });
  };

  const onPlay = () => {
    setHasError(false);
    if (!started.current) {
      started.current = true;
      trackMarketingVideo('marketing_video_started', media);
    }
  };
  const onTimeUpdate = () => {
    const video = videoRef.current;
    syncTime();
    if (!video || video.seeking) {
      return;
    }
    const percent = watchedPercentage(video.played, video.duration);
    for (const milestone of MILESTONES) {
      if (percent >= milestone && !milestones.current.has(milestone)) {
        milestones.current.add(milestone);
        trackMarketingVideo('marketing_video_progress', media, {
          percent: milestone,
        });
      }
    }
  };
  const onEnded = () => {
    const video = videoRef.current;
    onTimeUpdate();
    if (video) {
      // Reaching the end by seeking is not 100% watched; report the two facts separately.
      trackMarketingVideo('marketing_video_ended', media, {
        watched_percent: Math.round(
          watchedPercentage(video.played, video.duration)
        ),
      });
    }
  };
  const onError = () => {
    if (activated) {
      reportError();
    }
  };

  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video || duration === null || !Number.isFinite(time)) {
      return;
    }
    video.currentTime = Math.min(duration, Math.max(0, time));
    syncTime();
  };

  return {
    frameRef,
    videoRef,
    activated,
    hasError,
    inView,
    currentTime,
    duration,
    seek,
    syncTime,
    requestPlay,
    onPlay,
    onTimeUpdate,
    onEnded,
    onError,
  };
}
