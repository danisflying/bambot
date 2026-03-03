"use client";

import { useState, useCallback, useRef } from "react";
import {
  Episode,
  EpisodeFrame,
  EpisodeRecorderConfig,
  EpisodeSummary,
  RecorderPhase,
  DEFAULT_EPISODE_CONFIG,
  toEpisodeSummary,
} from "@/lib/episode";
import { servoPositionToAngle } from "@/lib/utils";

type GrabFrameBase64Fn = () => string | null;

export type EpisodeRecorderDeps = {
  /** Synchronous getter for the last-read leader arm positions (from tick loop cache).
   *  Returns Map<servoId, rawServoPosition>. No serial I/O — avoids port contention. */
  getLeaderPositions: () => Map<number, number>;
  /** Current follower joint states — we read the last-commanded angles */
  getFollowerAngles: () => number[];
  /** Ordered servo IDs matching the joint order */
  servoIds: number[];
  /** Ordered joint names matching the joint order */
  jointNames: string[];
  /** Camera frame grabbers, keyed by camera name. Each returns base64 JPEG or null */
  cameraGrabbers: Record<string, GrabFrameBase64Fn>;
};

export type EpisodeRecorderState = {
  /** Explicit phase — replaces the old isRecording/isPaused/hasLastEpisode booleans */
  phase: RecorderPhase;
  frameCount: number;
  elapsedMs: number;
  currentEpisodeId: number;
};

/**
 * Hook for recording ACT-compatible episodes.
 * Syncs: leader arm read (observation qpos) + follower write (action) + camera frames.
 *
 * Improvements over the v1 hook:
 * - Explicit state-machine phase (idle → recording ⇄ paused → reviewing → idle)
 * - Async-busy guard prevents overlapping frame captures
 * - Episode ID kept in a ref to avoid stale closures
 * - completedEpisodes stores only lightweight EpisodeSummary (no frame data)
 * - lastEpisode held in React state so consumers don't need forceRender hacks
 */
export function useEpisodeRecorder(
  deps: EpisodeRecorderDeps,
  config: EpisodeRecorderConfig = DEFAULT_EPISODE_CONFIG
) {
  const [state, setState] = useState<EpisodeRecorderState>({
    phase: "idle",
    frameCount: 0,
    elapsedMs: 0,
    currentEpisodeId: 0,
  });

  // The last completed episode — held in state so the UI re-renders automatically.
  const [lastEpisode, setLastEpisode] = useState<Episode | null>(null);

  // Lightweight summaries for the session list (no frame data retained).
  const [completedEpisodes, setCompletedEpisodes] = useState<EpisodeSummary[]>(
    []
  );

  // ── Internal refs (avoid stale closures in the capture interval) ────────

  const framesRef = useRef<EpisodeFrame[]>([]);
  const startTimeRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false); // async-overlap guard
  const episodeIdRef = useRef(0); // avoids stale closure on state.currentEpisodeId
  const configRef = useRef(config);
  const depsRef = useRef(deps);
  /** Last valid qpos — used as fallback to avoid recording 0-degree frames
   *  when the leader read cache is momentarily empty. */
  const lastQposRef = useRef<number[] | null>(null);

  // Keep refs in sync every render
  configRef.current = config;
  depsRef.current = deps;

  // ── Frame capture (async-safe) ──────────────────────────────────────────

  const captureFrame = useCallback(async () => {
    // Skip if previous capture is still in-flight
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      const {
        getLeaderPositions,
        getFollowerAngles,
        servoIds,
        cameraGrabbers,
      } = depsRef.current;
      const now = performance.now();
      const timestamp_ms = Math.round(now - startTimeRef.current);

      // 1. Read leader arm positions (observation qpos) — synchronous, from
      //    the tick loop’s cached snapshot.  No serial I/O, no port contention.
      const posMap = getLeaderPositions();
      let qpos: number[];
      if (posMap.size > 0) {
        qpos = servoIds.map((id) => {
          const raw = posMap.get(id);
          return raw !== undefined ? servoPositionToAngle(raw) : 0;
        });
        lastQposRef.current = qpos;
      } else {
        // Cache empty (leader tick hasn’t run yet or failed) — re-use last
        // known qpos instead of recording all-zero.
        qpos = lastQposRef.current ?? servoIds.map(() => 0);
      }

      // 2. Read follower joint angles (action — what was commanded)
      const action = getFollowerAngles();

      // 3. Grab camera frames
      const images: Record<string, string> = {};
      for (const [camName, grabFn] of Object.entries(cameraGrabbers)) {
        const frame = grabFn();
        if (frame) images[camName] = frame;
      }

      const frame: EpisodeFrame = {
        timestamp_ms,
        observation: { qpos, images },
        action,
      };

      framesRef.current.push(frame);
      setState((prev) => ({
        ...prev,
        frameCount: framesRef.current.length,
        elapsedMs: timestamp_ms,
      }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  // ── Interval helpers ────────────────────────────────────────────────────

  const clearCaptureInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startCaptureInterval = useCallback(() => {
    clearCaptureInterval();
    const intervalMs = Math.round(1000 / configRef.current.fps);
    intervalRef.current = setInterval(() => {
      captureFrame();
    }, intervalMs);
  }, [captureFrame, clearCaptureInterval]);

  // ── Public API ──────────────────────────────────────────────────────────

  /** Start recording a new episode (idle → recording). */
  const startRecording = useCallback(() => {
    framesRef.current = [];
    busyRef.current = false;
    startTimeRef.current = performance.now();
    startCaptureInterval();
    setLastEpisode(null);
    setState((prev) => ({
      ...prev,
      phase: "recording",
      frameCount: 0,
      elapsedMs: 0,
    }));
  }, [startCaptureInterval]);

  /** Pause recording (recording → paused). */
  const pauseRecording = useCallback(() => {
    clearCaptureInterval();
    setState((prev) => ({ ...prev, phase: "paused" }));
  }, [clearCaptureInterval]);

  /** Resume recording after pause (paused → recording). */
  const resumeRecording = useCallback(() => {
    startCaptureInterval();
    setState((prev) => ({ ...prev, phase: "recording" }));
  }, [startCaptureInterval]);

  /**
   * Stop recording and enter the review phase (recording|paused → reviewing).
   * The episode is stored in `lastEpisode` state — no ref + forceRender needed.
   */
  const stopRecording = useCallback(() => {
    clearCaptureInterval();

    const frames = [...framesRef.current];
    framesRef.current = [];

    if (frames.length === 0) {
      setState((prev) => ({ ...prev, phase: "idle" }));
      return;
    }

    const cfg = configRef.current;
    const id = episodeIdRef.current;

    const episode: Episode = {
      task: cfg.task,
      episode_id: id,
      robot: cfg.robot,
      fps: cfg.fps,
      success: true, // default — user can toggle in review phase
      joint_names: depsRef.current.jointNames,
      frames,
      camera_names: cfg.cameraNames,
      created_at: new Date().toISOString(),
    };

    episodeIdRef.current = id + 1;
    setLastEpisode(episode);
    setState((prev) => ({
      ...prev,
      phase: "reviewing",
      frameCount: 0,
      elapsedMs: 0,
      currentEpisodeId: id + 1,
    }));
  }, [clearCaptureInterval]);

  /** Discard current recording without saving (recording|paused → idle). */
  const discardRecording = useCallback(() => {
    clearCaptureInterval();
    framesRef.current = [];
    busyRef.current = false;
    setState((prev) => ({
      ...prev,
      phase: "idle",
      frameCount: 0,
      elapsedMs: 0,
    }));
  }, [clearCaptureInterval]);

  /** Accept the episode: add summary to session list, then clear (reviewing → idle). */
  const acceptEpisode = useCallback(
    (success: boolean, notes?: string) => {
      if (!lastEpisode) return;
      const tagged: Episode = { ...lastEpisode, success, notes };
      // Store only a lightweight summary — no frame data retained in state.
      setCompletedEpisodes((prev) => [...prev, toEpisodeSummary(tagged)]);
      setLastEpisode(null);
      setState((prev) => ({ ...prev, phase: "idle" }));
    },
    [lastEpisode]
  );

  /** Discard the episode in review without saving (reviewing → idle). */
  const discardReviewedEpisode = useCallback(() => {
    setLastEpisode(null);
    setState((prev) => ({ ...prev, phase: "idle" }));
  }, []);

  // ── Save / Download ─────────────────────────────────────────────────────

  /** Save an episode to the server. */
  const saveEpisode = useCallback(
    async (episode: Episode): Promise<boolean> => {
      try {
        const res = await fetch("/api/episodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(episode),
        });
        return res.ok;
      } catch (err) {
        console.error("Failed to save episode:", err);
        return false;
      }
    },
    []
  );

  /** Download an episode as a JSON file. */
  const downloadEpisode = useCallback((episode: Episode) => {
    const dataStr = JSON.stringify(episode);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${episode.task}_ep${episode.episode_id}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Clear session summary list. */
  const clearCompletedEpisodes = useCallback(() => {
    setCompletedEpisodes([]);
  }, []);

  return {
    state,
    lastEpisode,
    completedEpisodes,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    acceptEpisode,
    discardReviewedEpisode,
    saveEpisode,
    downloadEpisode,
    clearCompletedEpisodes,
  };
}
