import React, { useState, useEffect } from "react";
import type { Episode } from "@/lib/episode";

interface EpisodeReviewProps {
  episode: Episode;
  onSave: (episode: Episode) => Promise<boolean>;
  onDownload: (episode: Episode) => void;
  /** Accept with success/fail tag + notes, then transition to idle */
  onAccept: (success: boolean, notes?: string) => void;
  /** Discard without saving */
  onDiscard: () => void;
}

export default function EpisodeReview({
  episode,
  onSave,
  onDownload,
  onAccept,
  onDiscard,
}: EpisodeReviewProps) {
  const [successTag, setSuccessTag] = useState(true);
  const [notes, setNotes] = useState("");
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

  // Auto-clear save result after 3s
  useEffect(() => {
    if (saveResult) {
      const t = setTimeout(() => setSaveResult(null), 3000);
      return () => clearTimeout(t);
    }
  }, [saveResult]);

  const handleSave = async () => {
    const tagged: Episode = { ...episode, success: successTag, notes: notes || undefined };
    const ok = await onSave(tagged);
    setSaveResult(ok ? "success" : "error");
    if (ok) {
      onAccept(successTag, notes || undefined);
    }
  };

  const handleDownload = () => {
    const tagged: Episode = { ...episode, success: successTag, notes: notes || undefined };
    onDownload(tagged);
  };

  return (
    <div className="mb-3 space-y-2 border-t border-white/20 pt-2">
      {/* Success / Fail toggle */}
      <div className="flex items-center gap-2">
        <label className="text-xs w-16 shrink-0">Result</label>
        <div className="flex gap-2">
          <button
            className={`px-2 py-1 rounded text-xs ${
              successTag ? "bg-green-600 text-white" : "bg-zinc-700 text-zinc-300"
            }`}
            onClick={() => setSuccessTag(true)}
          >
            Success
          </button>
          <button
            className={`px-2 py-1 rounded text-xs ${
              !successTag ? "bg-red-600 text-white" : "bg-zinc-700 text-zinc-300"
            }`}
            onClick={() => setSuccessTag(false)}
          >
            Fail
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="flex items-start gap-2">
        <label className="text-xs w-16 shrink-0 pt-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white resize-none"
          rows={2}
          placeholder="Optional notes..."
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          className="flex-1 bg-blue-600 hover:bg-blue-500 px-2 py-1.5 rounded text-xs"
          onClick={handleSave}
        >
          Save to Server
        </button>
        <button
          className="flex-1 bg-zinc-700 hover:bg-zinc-600 px-2 py-1.5 rounded text-xs"
          onClick={handleDownload}
        >
          Download JSON
        </button>
        <button
          className="px-2 py-1.5 rounded text-xs bg-zinc-700 hover:bg-zinc-600"
          onClick={onDiscard}
        >
          Clear
        </button>
      </div>

      {/* Save feedback */}
      {saveResult && (
        <div
          className={`text-xs mt-1 ${
            saveResult === "success" ? "text-green-400" : "text-red-400"
          }`}
        >
          {saveResult === "success"
            ? "Episode saved successfully!"
            : "Failed to save episode. Check console."}
        </div>
      )}
    </div>
  );
}
