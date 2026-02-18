"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export type CameraConfig = {
  name: string;
  width: number;
  height: number;
  quality: number; // JPEG quality 0-1
};

const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  name: "cam_high",
  width: 640,
  height: 480,
  quality: 0.85,
};

export type CameraState = {
  isActive: boolean;
  deviceId: string | null;
  stream: MediaStream | null;
  error: string | null;
};

/**
 * Hook to capture camera frames using MediaDevices API.
 * Returns a video ref (for preview), start/stop controls, and a grabFrame() function
 * that grabs the current frame as a JPEG Blob.
 */
export function useCamera(config: CameraConfig = DEFAULT_CAMERA_CONFIG) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<CameraState>({
    isActive: false,
    deviceId: null,
    stream: null,
    error: null,
  });
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>(
    []
  );

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

  // Initialize canvas for frame extraction
  useEffect(() => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = config.width;
      canvas.height = config.height;
      canvasRef.current = canvas;
    } else {
      canvasRef.current.width = config.width;
      canvasRef.current.height = config.height;
    }
  }, [config.width, config.height]);

  // Start camera
  const startCamera = useCallback(
    async (deviceId?: string) => {
      try {
        // Stop existing stream first
        if (state.stream) {
          state.stream.getTracks().forEach((track) => track.stop());
        }

        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: config.width },
            height: { ideal: config.height },
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
          audio: false,
        };

        const stream =
          await navigator.mediaDevices.getUserMedia(constraints);

        // Attach stream to video element for preview
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {}); // autoplay may be blocked
        }

        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();

        setState({
          isActive: true,
          deviceId: settings.deviceId ?? deviceId ?? null,
          stream,
          error: null,
        });

        // Refresh device list after connecting (labels become available)
        refreshDevices();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start camera";
        setState((prev) => ({
          ...prev,
          isActive: false,
          error: message,
        }));
        console.error("Camera start error:", err);
      }
    },
    [config.width, config.height, state.stream, refreshDevices]
  );

  // Stop camera
  const stopCamera = useCallback(() => {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setState({
      isActive: false,
      deviceId: null,
      stream: null,
      error: null,
    });
  }, [state.stream]);

  // Grab current frame as JPEG Blob
  const grabFrame = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !state.isActive) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Draw the current video frame onto the canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to JPEG blob
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        config.quality
      );
    });
  }, [state.isActive, config.quality]);

  // Grab frame as base64 data URL (useful for smaller uploads)
  const grabFrameBase64 = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !state.isActive) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", config.quality);
  }, [state.isActive, config.quality]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (state.stream) {
        state.stream.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    videoRef,
    state,
    availableDevices,
    refreshDevices,
    startCamera,
    stopCamera,
    grabFrame,
    grabFrameBase64,
  };
}
