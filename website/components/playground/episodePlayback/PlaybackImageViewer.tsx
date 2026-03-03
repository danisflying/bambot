"use client";

import React, { useState, useRef, useEffect } from "react";

interface PlaybackImageViewerProps {
  /** Pre-decoded HTMLImageElement objects keyed by camera name */
  images: Record<string, HTMLImageElement>;
}

export default function PlaybackImageViewer({ images }: PlaybackImageViewerProps) {
  const cameraNames = Object.keys(images);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auto-select first camera
  const activeCam =
    selectedCamera && cameraNames.includes(selectedCamera)
      ? selectedCamera
      : cameraNames[0] ?? null;

  // Draw current image to canvas whenever it changes
  const activeImg = activeCam ? images[activeCam] : null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeImg) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match canvas size to image
    if (canvas.width !== activeImg.naturalWidth || canvas.height !== activeImg.naturalHeight) {
      canvas.width = activeImg.naturalWidth;
      canvas.height = activeImg.naturalHeight;
    }

    ctx.drawImage(activeImg, 0, 0);
  }, [activeImg]);

  if (cameraNames.length === 0) {
    return (
      <div className="text-xs text-zinc-500 italic my-1">No camera images in this frame.</div>
    );
  }

  return (
    <div className="mt-2 border-t border-white/20 pt-2">
      {/* Camera tabs */}
      {cameraNames.length > 1 && (
        <div className="flex gap-1 mb-1.5">
          {cameraNames.map((name) => (
            <button
              key={name}
              className={`px-2 py-0.5 rounded text-xs ${
                activeCam === name
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
              onClick={() => setSelectedCamera(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Canvas image display — draws instantly from pre-decoded images */}
      <div className="relative rounded overflow-hidden border border-zinc-700">
        <canvas
          ref={canvasRef}
          className="w-full h-auto block"
        />
        {activeCam && (
          <div className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
            {activeCam}
          </div>
        )}
      </div>
    </div>
  );
}
