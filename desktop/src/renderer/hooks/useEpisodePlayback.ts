import { useState, useCallback, useRef, useEffect } from "react";
import type { EpisodeSummary } from "@/lib/episode";

// ── Types ──────────────────────────────────────────────────────────────────

/** A stored frame as returned by the API (images are file paths, not base64) */
export type StoredFrame = {
  timestamp_ms: number;
  observation: {
    qpos: number[];
    images: Record<string, string>; // e.g. { cam_high: "images/frame_000000_cam_high.jpg" }
  };
  action: number[];
};

/** A stored episode with frames (as returned by the detail API) */
export type StoredEpisode = EpisodeSummary & {
  frames: StoredFrame[];
};

export type PlaybackPhase = "idle" | "loading" | "ready" | "playing" | "paused";

export type PlaybackState = {
  phase: PlaybackPhase;
  /** Currently loaded episode metadata */
  episode: EpisodeSummary | null;
  /** Current frame index during playback */
  frameIndex: number;
  /** Total frames in the loaded episode */
  totalFrames: number;
  /** Current playback speed multiplier (1 = normal) */
  speed: number;
  /** Current frame's action angles (for driving the 3D model) */
  currentAction: number[] | null;
  /** Current frame's observation qpos */
  currentQpos: number[] | null;
  /** Current frame's pre-decoded camera images, keyed by camera name */
  currentImages: Record<string, HTMLImageElement>;
  /** Error message if loading failed */
  error: string | null;
  /** Image prefetch progress 0-1 */
  prefetchProgress: number;
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function useEpisodePlayback() {
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [episode, setEpisode] = useState<EpisodeSummary | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [currentAction, setCurrentAction] = useState<number[] | null>(null);
  const [currentQpos, setCurrentQpos] = useState<number[] | null>(null);
  const [currentImages, setCurrentImages] = useState<Record<string, HTMLImageElement>>({});
  const [error, setError] = useState<string | null>(null);
  const [prefetchProgress, setPrefetchProgress] = useState(0);

  // Internal refs
  const framesRef = useRef<StoredFrame[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);
  const episodeMetaRef = useRef<EpisodeSummary | null>(null);
  const frameIndexRef = useRef(0);

  /**
   * Image cache: maps API URL → pre-decoded HTMLImageElement.
   * Populated during loadEpisode, consumed by applyFrame.
   */
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Keep speed ref in sync
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // ── List saved episodes ────────────────────────────────────────────────

  const [episodeList, setEpisodeList] = useState<EpisodeSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const fetchEpisodeList = useCallback(async () => {
    setListLoading(true);
    try {
      const episodes = await window.electron.fs.readEpisodes();
      setEpisodeList(episodes);
    } catch (err) {
      console.error("Failed to fetch episode list:", err);
      setEpisodeList([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  // ── Build image URL for a stored frame ─────────────────────────────────

  const buildImageUrl = useCallback(
    (task: string, episodeId: number, imageRef: string): string => {
      // imageRef is like "images/frame_000000_cam_high.jpg"
      // Serve via the registered local:// protocol → data/episodes/{task}/ep_{id}/{imageRef}
      const encodedTask = encodeURIComponent(task);
      const encodedRef = imageRef.split("/").map(encodeURIComponent).join("/");
      return `local://${encodedTask}/ep_${episodeId}/${encodedRef}`;
    },
    []
  );

  // ── Apply a frame (update state) ──────────────────────────────────────

  const applyFrame = useCallback(
    (index: number) => {
      const frames = framesRef.current;
      const meta = episodeMetaRef.current;
      if (!meta || index < 0 || index >= frames.length) return;

      const frame = frames[index];
      frameIndexRef.current = index;
      setFrameIndex(index);
      setCurrentAction(frame.action);
      setCurrentQpos(frame.observation.qpos);

      // Lookup pre-decoded images from cache
      const imgs: Record<string, HTMLImageElement> = {};
      for (const [camName, imageRef] of Object.entries(frame.observation.images)) {
        if (imageRef) {
          const url = buildImageUrl(meta.task, meta.episode_id, imageRef);
          const cached = imageCacheRef.current.get(url);
          if (cached) imgs[camName] = cached;
        }
      }
      setCurrentImages(imgs);
    },
    [buildImageUrl]
  );

  // ── Interval management ────────────────────────────────────────────────

  const clearPlaybackInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPlaybackInterval = useCallback(() => {
    clearPlaybackInterval();
    const meta = episodeMetaRef.current;
    if (!meta) return;

    const baseIntervalMs = Math.round(1000 / meta.fps);

    const tick = () => {
      const nextIndex = frameIndexRef.current + 1;
      if (nextIndex >= framesRef.current.length) {
        // Reached end: stop playback
        clearPlaybackInterval();
        setPhase("ready");
        return;
      }
      applyFrame(nextIndex);
    };

    // Use dynamic interval that respects speed
    const scheduleNext = () => {
      intervalRef.current = setTimeout(() => {
        tick();
        if (frameIndexRef.current < framesRef.current.length - 1) {
          scheduleNext();
        }
      }, baseIntervalMs / speedRef.current) as unknown as ReturnType<typeof setInterval>;
    };

    scheduleNext();
  }, [applyFrame, clearPlaybackInterval]);

  // ── Image prefetching ───────────────────────────────────────────────────

  /** Prefetch a single image URL into an HTMLImageElement, resolved when decoded. */
  const prefetchImage = useCallback((url: string): Promise<HTMLImageElement> => {
    // Already cached?
    const existing = imageCacheRef.current.get(url);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageCacheRef.current.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }, []);

  /**
   * Prefetch all images for the loaded frames in batches.
   * Updates prefetchProgress as images arrive.
   */
  const prefetchAllImages = useCallback(
    async (frames: StoredFrame[], task: string, episodeId: number) => {
      // Collect all unique image URLs
      const urls: string[] = [];
      for (const frame of frames) {
        for (const imageRef of Object.values(frame.observation.images)) {
          if (imageRef) {
            urls.push(buildImageUrl(task, episodeId, imageRef));
          }
        }
      }

      if (urls.length === 0) {
        setPrefetchProgress(1);
        return;
      }

      let loaded = 0;
      setPrefetchProgress(0);

      // Fetch in concurrent batches of 20 to avoid overwhelming the browser
      const BATCH_SIZE = 20;
      for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((url) =>
            prefetchImage(url).finally(() => {
              loaded++;
              setPrefetchProgress(loaded / urls.length);
            })
          )
        );
      }
    },
    [buildImageUrl, prefetchImage]
  );

  // ── Public API ─────────────────────────────────────────────────────────

  /** Load an episode from the server */
  const loadEpisode = useCallback(
    async (summary: EpisodeSummary) => {
      clearPlaybackInterval();
      setPhase("loading");
      setError(null);
      setPrefetchProgress(0);

      // Clear old image cache
      imageCacheRef.current.clear();

      try {
        const data = await window.electron.fs.readEpisodeDetail(summary.task, summary.episode_id);

        framesRef.current = data.frames;
        episodeMetaRef.current = summary;
        frameIndexRef.current = 0;

        setEpisode(summary);
        setTotalFrames(data.frames.length);

        // Prefetch all images into memory before marking ready
        await prefetchAllImages(data.frames, summary.task, summary.episode_id);

        setPhase("ready");

        // Apply the first frame
        if (data.frames.length > 0) {
          applyFrame(0);
        }
      } catch (err) {
        console.error("Failed to load episode:", err);
        setError(err instanceof Error ? err.message : "Failed to load episode");
        setPhase("idle");
      }
    },
    [clearPlaybackInterval, applyFrame, prefetchAllImages]
  );

  /** Start or resume playback */
  const play = useCallback(() => {
    if (framesRef.current.length === 0) return;

    // If at the end, restart from beginning
    if (frameIndexRef.current >= framesRef.current.length - 1) {
      applyFrame(0);
    }

    setPhase("playing");
    startPlaybackInterval();
  }, [applyFrame, startPlaybackInterval]);

  /** Pause playback */
  const pause = useCallback(() => {
    clearPlaybackInterval();
    setPhase("paused");
  }, [clearPlaybackInterval]);

  /** Stop playback and reset to beginning */
  const stop = useCallback(() => {
    clearPlaybackInterval();
    if (framesRef.current.length > 0) {
      applyFrame(0);
    }
    setPhase("ready");
  }, [clearPlaybackInterval, applyFrame]);

  /** Seek to a specific frame */
  const seekTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, framesRef.current.length - 1));
      applyFrame(clamped);
    },
    [applyFrame]
  );

  /** Step forward one frame */
  const stepForward = useCallback(() => {
    const next = Math.min(frameIndexRef.current + 1, framesRef.current.length - 1);
    applyFrame(next);
  }, [applyFrame]);

  /** Step backward one frame */
  const stepBackward = useCallback(() => {
    const prev = Math.max(frameIndexRef.current - 1, 0);
    applyFrame(prev);
  }, [applyFrame]);

  /** Change playback speed */
  const setPlaybackSpeed = useCallback(
    (newSpeed: number) => {
      setSpeed(newSpeed);
      // If currently playing, restart interval with new speed
      if (phase === "playing") {
        startPlaybackInterval();
      }
    },
    [phase, startPlaybackInterval]
  );

  /** Unload episode and return to idle */
  const unload = useCallback(() => {
    clearPlaybackInterval();
    framesRef.current = [];
    episodeMetaRef.current = null;
    frameIndexRef.current = 0;
    imageCacheRef.current.clear();
    setPhase("idle");
    setEpisode(null);
    setFrameIndex(0);
    setTotalFrames(0);
    setCurrentAction(null);
    setCurrentQpos(null);
    setCurrentImages({});
    setError(null);
    setPrefetchProgress(0);
  }, [clearPlaybackInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearPlaybackInterval();
  }, [clearPlaybackInterval]);

  return {
    state: {
      phase,
      episode,
      frameIndex,
      totalFrames,
      speed,
      currentAction,
      currentQpos,
      currentImages,
      error,
      prefetchProgress,
    } as PlaybackState,

    // Episode list
    episodeList,
    listLoading,
    fetchEpisodeList,

    // Playback controls
    loadEpisode,
    play,
    pause,
    stop,
    seekTo,
    stepForward,
    stepBackward,
    setPlaybackSpeed,
    unload,
  };
}
