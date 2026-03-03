import React, { useEffect, useRef } from "react";

interface CameraPreviewProps {
  name: string;
  getVideoElement: (name: string) => HTMLVideoElement | null;
  isActive: boolean;
}

/**
 * Renders a live camera preview by attaching the managed <video> element
 * from useCameras into a container div.
 */
export default function CameraPreview({
  name,
  getVideoElement,
  isActive,
}: CameraPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const videoEl = getVideoElement(name);
    if (videoEl && isActive) {
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "cover";
      videoEl.style.display = "block";

      if (videoEl.parentElement !== container) {
        container.innerHTML = "";
        container.appendChild(videoEl);
      }
    }

    return () => {
      if (videoEl && videoEl.parentElement === container) {
        container.removeChild(videoEl);
      }
    };
  }, [name, getVideoElement, isActive]);

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded overflow-hidden"
      style={{ aspectRatio: "4/3" }}
    >
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs">
          Not started
        </div>
      )}
    </div>
  );
}
