import { useState, useCallback, useRef, useEffect } from "react";
import {
  DEFAULT_CAM_WIDTH,
  DEFAULT_CAM_HEIGHT,
  DEFAULT_CAM_QUALITY,
} from "@/config/cameraConfig";

export type CameraConfig = {
  name: string;
  width: number;
  height: number;
  quality: number; // JPEG quality 0-1
};

export type SimulatedCameraType = "noise" | "robot_view";

export type CameraInstance = {
  name: string;
  config: CameraConfig;
  isActive: boolean;
  deviceId: string | null;
  stream: MediaStream | null;
  error: string | null;
  videoEl: HTMLVideoElement;
  canvasEl: HTMLCanvasElement;
  // Simulated camera fields
  isSimulated: boolean;
  simulationType?: SimulatedCameraType;
  sourceCanvas?: HTMLCanvasElement | null; // for robot_view type
  animFrameId?: number; // for noise animation loop
};

export type CameraInstanceState = {
  name: string;
  isActive: boolean;
  deviceId: string | null;
  error: string | null;
  isSimulated: boolean;
  simulationType?: SimulatedCameraType;
};

const DEFAULT_WIDTH = DEFAULT_CAM_WIDTH;
const DEFAULT_HEIGHT = DEFAULT_CAM_HEIGHT;
const DEFAULT_QUALITY = DEFAULT_CAM_QUALITY;

// ── Noise generator helpers ───────────────────────────────────────────────

function drawNoise(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = (Math.random() * 80 + 40) | 0; // dark grey noise
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  // Tint: overlay a subtle label in the corner
  ctx.putImageData(imageData, 0, 0);
  ctx.fillStyle = "rgba(0,200,100,0.6)";
  ctx.font = `bold ${Math.max(10, w / 32)}px monospace`;
  ctx.fillText("SIM", 8, 20);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = `${Math.max(8, w / 48)}px monospace`;
  ctx.fillText(new Date().toISOString().slice(11, 23), 8, h - 8);
}

/**
 * Hook to manage multiple named cameras.
 * Each camera gets its own video/canvas element, stream, and frame grabber.
 * Also supports simulated cameras: noise and robot_view (from a Three.js canvas).
 */
export function useCameras() {
  const instancesRef = useRef<Map<string, CameraInstance>>(new Map());
  const [cameraStates, setCameraStates] = useState<CameraInstanceState[]>([]);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>(
    []
  );

  // Sync React state from internal instances
  const syncState = useCallback(() => {
    const states: CameraInstanceState[] = [];
    instancesRef.current.forEach((inst) => {
      states.push({
        name: inst.name,
        isActive: inst.isActive,
        deviceId: inst.deviceId,
        error: inst.error,
        isSimulated: inst.isSimulated,
        simulationType: inst.simulationType,
      });
    });
    setCameraStates(states);
  }, []);

  // Enumerate available video devices
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      setAvailableDevices(videoDevices);
      return videoDevices;
    } catch {
      console.error("Failed to enumerate devices");
      return [];
    }
  }, []);

  // Add a camera slot (does not start the stream)
  const addCamera = useCallback(
    (name: string, config?: Partial<Omit<CameraConfig, "name">>) => {
      if (instancesRef.current.has(name)) return; // already exists

      const width = config?.width ?? DEFAULT_WIDTH;
      const height = config?.height ?? DEFAULT_HEIGHT;

      const videoEl = document.createElement("video");
      videoEl.playsInline = true;
      videoEl.muted = true;
      videoEl.autoplay = true;

      const canvasEl = document.createElement("canvas");
      canvasEl.width = width;
      canvasEl.height = height;

      const instance: CameraInstance = {
        name,
        config: { name, width, height, quality: config?.quality ?? DEFAULT_QUALITY },
        isActive: false,
        deviceId: null,
        stream: null,
        error: null,
        videoEl,
        canvasEl,
        isSimulated: false,
      };

      instancesRef.current.set(name, instance);
      syncState();
    },
    [syncState]
  );

  // Remove a camera (stops stream and animation if active)
  const removeCamera = useCallback(
    (name: string) => {
      const inst = instancesRef.current.get(name);
      if (!inst) return;

      if (inst.animFrameId !== undefined) {
        cancelAnimationFrame(inst.animFrameId);
      }
      if (inst.stream) {
        inst.stream.getTracks().forEach((t) => t.stop());
      }
      inst.videoEl.srcObject = null;
      instancesRef.current.delete(name);
      syncState();
    },
    [syncState]
  );

  // Start a real camera's stream.
  // Includes retry logic for NotReadableError � on Windows, webcam drivers
  // often hold exclusive locks and need time to release between stop/start.
  const startCamera = useCallback(
    async (name: string, deviceId?: string) => {
      const inst = instancesRef.current.get(name);
      if (!inst) return;

      // -- Tear down any existing stream fully ----------------------------
      if (inst.animFrameId !== undefined) {
        cancelAnimationFrame(inst.animFrameId);
        inst.animFrameId = undefined;
      }
      if (inst.stream) {
        inst.stream.getTracks().forEach((t) => t.stop());
        inst.stream = null;
      }
      inst.videoEl.srcObject = null;

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: inst.config.width },
          height: { ideal: inst.config.height },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        audio: false,
      };

      // -- Attempt with retries (handles Windows driver release lag) ------
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 500; // give the driver time to release

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Small delay before first attempt too, to let any just-stopped
          // track fully release (needed on Windows with exclusive-lock drivers)
          if (attempt > 1) {
            console.warn(
              `Camera "${name}" retry ${attempt}/${MAX_RETRIES} after NotReadableError�`
            );
          }
          await new Promise((r) => setTimeout(r, attempt === 1 ? 100 : RETRY_DELAY_MS));

          const stream = await navigator.mediaDevices.getUserMedia(constraints);

          inst.videoEl.srcObject = stream;
          inst.videoEl.play().catch(() => {});

          const track = stream.getVideoTracks()[0];
          const settings = track.getSettings();

          inst.stream = stream;
          inst.isActive = true;
          inst.isSimulated = false;
          inst.simulationType = undefined;
          inst.deviceId = settings.deviceId ?? deviceId ?? null;
          inst.error = null;

          syncState();
          refreshDevices();
          return; // success � exit
        } catch (err) {
          const isNotReadable =
            err instanceof DOMException && err.name === "NotReadableError";

          if (isNotReadable && attempt < MAX_RETRIES) {
            // Retriable � Windows driver probably hasn't released yet
            continue;
          }

          // Final failure
          inst.isActive = false;
          inst.error =
            isNotReadable
              ? "Device busy � close other apps using this camera and try again"
              : err instanceof Error
                ? err.message
                : "Failed to start camera";
          syncState();
          console.error(`Camera "${name}" start error:`, err);
          return;
        }
      }
    },
    [syncState, refreshDevices]
  );

  /**
   * Start a simulated camera:
   * - type "noise" — animated grey noise drawn on the instance's own canvas
   * - type "robot_view" — captures a stream from the provided sourceCanvas (Three.js canvas)
   */
  const startSimulatedCamera = useCallback(
    (
      name: string,
      type: SimulatedCameraType,
      sourceCanvas?: HTMLCanvasElement | null,
      fps: number = 30
    ) => {
      const inst = instancesRef.current.get(name);
      if (!inst) return;

      // Stop any previous activity
      if (inst.animFrameId !== undefined) {
        cancelAnimationFrame(inst.animFrameId);
        inst.animFrameId = undefined;
      }
      if (inst.stream) {
        inst.stream.getTracks().forEach((t) => t.stop());
        inst.stream = null;
      }
      inst.videoEl.srcObject = null;

      inst.isSimulated = true;
      inst.simulationType = type;

      if (type === "noise") {
        // Draw noise and capture the canvas as a stream
        drawNoise(inst.canvasEl);
        const stream = (inst.canvasEl as HTMLCanvasElement & {
          captureStream(fps?: number): MediaStream;
        }).captureStream(fps);
        inst.stream = stream;
        inst.videoEl.srcObject = stream;
        inst.videoEl.play().catch(() => {});

        // Keep animating so the noise moves
        let lastTime = 0;
        const interval = 1000 / fps;
        const animate = (now: number) => {
          if (now - lastTime >= interval) {
            drawNoise(inst.canvasEl);
            lastTime = now;
          }
          inst.animFrameId = requestAnimationFrame(animate);
        };
        inst.animFrameId = requestAnimationFrame(animate);

        inst.isActive = true;
        inst.deviceId = "sim:noise";
        inst.error = null;
        syncState();
      } else if (type === "robot_view") {
        if (!sourceCanvas) {
          inst.error = "No robot view canvas available";
          syncState();
          return;
        }
        inst.sourceCanvas = sourceCanvas;

        // Capture the Three.js canvas directly as a stream
        const stream = (sourceCanvas as HTMLCanvasElement & {
          captureStream(fps?: number): MediaStream;
        }).captureStream(fps);
        inst.stream = stream;
        inst.videoEl.srcObject = stream;
        inst.videoEl.play().catch(() => {});

        inst.isActive = true;
        inst.deviceId = "sim:robot_view";
        inst.error = null;
        syncState();
      }
    },
    [syncState]
  );

  // Stop a camera's stream
  const stopCamera = useCallback(
    (name: string) => {
      const inst = instancesRef.current.get(name);
      if (!inst) return;

      if (inst.animFrameId !== undefined) {
        cancelAnimationFrame(inst.animFrameId);
        inst.animFrameId = undefined;
      }
      if (inst.stream) {
        inst.stream.getTracks().forEach((t) => t.stop());
      }
      inst.videoEl.srcObject = null;
      inst.stream = null;
      inst.isActive = false;
      inst.deviceId = null;
      inst.error = null;
      inst.isSimulated = false;
      inst.simulationType = undefined;
      inst.sourceCanvas = undefined;
      syncState();
    },
    [syncState]
  );

  // Get the video element for a camera (for preview)
  const getVideoElement = useCallback(
    (name: string): HTMLVideoElement | null => {
      return instancesRef.current.get(name)?.videoEl ?? null;
    },
    []
  );

  // Grab a single camera frame as base64 JPEG
  const grabFrameBase64 = useCallback((name: string): string | null => {
    const inst = instancesRef.current.get(name);
    if (!inst || !inst.isActive) return null;

    const ctx = inst.canvasEl.getContext("2d");
    if (!ctx) return null;

    if (inst.isSimulated && inst.simulationType === "noise") {
      // Canvas is already up-to-date from the animation loop
      return inst.canvasEl.toDataURL("image/jpeg", inst.config.quality);
    } else if (inst.isSimulated && inst.simulationType === "robot_view" && inst.sourceCanvas) {
      // Copy the Three.js canvas to our canvas, then read
      ctx.drawImage(inst.sourceCanvas, 0, 0, inst.canvasEl.width, inst.canvasEl.height);
      return inst.canvasEl.toDataURL("image/jpeg", inst.config.quality);
    } else {
      // Real camera — draw video frame to canvas
      ctx.drawImage(inst.videoEl, 0, 0, inst.canvasEl.width, inst.canvasEl.height);
      return inst.canvasEl.toDataURL("image/jpeg", inst.config.quality);
    }
  }, []);

  // Build grabbers record for useEpisodeRecorder
  const getGrabbers = useCallback((): Record<string, () => string | null> => {
    const grabbers: Record<string, () => string | null> = {};
    instancesRef.current.forEach((_, name) => {
      grabbers[name] = () => grabFrameBase64(name);
    });
    return grabbers;
  }, [grabFrameBase64]);

  // Get ordered camera names
  const getCameraNames = useCallback((): string[] => {
    return Array.from(instancesRef.current.keys());
  }, []);

  const allActive = cameraStates.length > 0 && cameraStates.every((c) => c.isActive);
  const anyActive = cameraStates.some((c) => c.isActive);
  const cameraCount = cameraStates.length;

  // Cleanup on unmount
  useEffect(() => {
    refreshDevices();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      instancesRef.current.forEach((inst) => {
        if (inst.animFrameId !== undefined) cancelAnimationFrame(inst.animFrameId);
        if (inst.stream) inst.stream.getTracks().forEach((t) => t.stop());
      });
    };
  }, []);

  return {
    cameraStates,
    availableDevices,
    allActive,
    anyActive,
    cameraCount,
    refreshDevices,
    addCamera,
    removeCamera,
    startCamera,
    startSimulatedCamera,
    stopCamera,
    getVideoElement,
    grabFrameBase64,
    getGrabbers,
    getCameraNames,
  };
}
