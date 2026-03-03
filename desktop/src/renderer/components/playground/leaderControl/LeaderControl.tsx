import React, { useState, useEffect, useRef, useMemo } from "react";
import { servoPositionToAngle } from "@/lib/utils";
import { Rnd } from "react-rnd";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { LeaderConnectionHelpDialog } from "./LeaderConnectionHelpDialog";
import { PortSelector } from "../controlButtons/PortSelector";

/**
 * props:
 * - leaderControl: { isConnected, connectLeader, disconnectLeader, positions }
 * - jointDetails: JointDetails[]
 * - onSync: (leaderAngles: { servoId: number, angle: number }[]) => void
 * - show: boolean
 * - onHide: () => void
 */

const SYNC_INTERVAL = 10; // ms — target interval between leader reads

const LeaderControl = ({
  leaderControl,
  jointDetails,
  onSync,
  show = true,
  onHide,
}) => {
  const revoluteJoints = useMemo(
    () => jointDetails.filter((j) => j.jointType === "revolute"),
    [jointDetails]
  );
  const { isConnected, connectLeader, disconnectLeader, getPositions } =
    leaderControl;
  const [angles, setAngles] = useState(
    revoluteJoints.map((j) => ({
      servoId: j.servoId,
      angle: 0,
    }))
  );
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "disconnecting"
  >("idle");
  const [loopLatencyMs, setLoopLatencyMs] = useState<number | null>(null);
  const [ref, bounds] = useMeasure();

  // Phase 1 — Electron native serial port selection
  const isElectron = typeof window !== "undefined" && !!window.electron;
  const [selectedPort, setSelectedPort] = useState<string | null>(null);

  // Use refs for values accessed inside the async tick loop so the effect
  // only restarts when `isConnected` changes — not on every render.
  const onSyncRef = useRef(onSync);
  const getPositionsRef = useRef(getPositions);
  const revoluteJointsRef = useRef(revoluteJoints);
  useEffect(() => { onSyncRef.current = onSync; }, [onSync]);
  useEffect(() => { getPositionsRef.current = getPositions; }, [getPositions]);
  useEffect(() => { revoluteJointsRef.current = revoluteJoints; }, [revoluteJoints]);

  // Self-scheduling async loop — prevents overlap when reads take longer than SYNC_INTERVAL.
  // The effect depends ONLY on `isConnected` so it doesn't restart on every
  // parent re-render (which was previously causing concurrent serial reads and
  // the "Port is busy" / COMM_PORT_BUSY errors).
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    const tick = async () => {
      while (!cancelled) {
        const t0 = performance.now();
        try {
          const positions = await getPositionsRef.current();
          if (positions.size > 0 && !cancelled) {
            const joints = revoluteJointsRef.current;
            const leaderAngles = joints.map((j) => ({
              servoId: j.servoId,
              angle: servoPositionToAngle(positions.get(j.servoId) ?? 0),
            }));
            setAngles(leaderAngles);
            onSyncRef.current(leaderAngles);
          }
        } catch (e) {
          console.error("Leader sync error:", e);
        }
        const elapsed = performance.now() - t0;
        setLoopLatencyMs(Math.round(elapsed));
        const wait = Math.max(1, SYNC_INTERVAL - elapsed);
        if (!cancelled) await new Promise((r) => setTimeout(r, wait));
      }
    };

    tick();
    return () => { cancelled = true; };
  }, [isConnected]);

  // Initially position to bottom left corner
  useEffect(() => {
    if (bounds.height > 0) {
      setPosition({ x: 20, y: window.innerHeight - bounds.height - 20 });
    }
  }, [bounds.height]);

  const handleConnect = async () => {
    setConnectionStatus("connecting");
    try {
      await connectLeader(isElectron ? (selectedPort ?? undefined) : undefined);
    } finally {
      setConnectionStatus("idle");
    }
  };

  const handleDisconnect = async () => {
    setConnectionStatus("disconnecting");
    try {
      await disconnectLeader();
      // Reset angles to 0 when disconnected
      setAngles(
        revoluteJoints.map((j) => ({
          servoId: j.servoId,
          angle: 0,
        }))
      );
    } finally {
      setConnectionStatus("idle");
    }
  };

  if (!show) return null;

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-50"
      style={{ display: show ? undefined : "none" }}
      cancel="input,select,textarea,button,a,option"
    >
      <div
        ref={ref}
        className={"max-h-[90vh] overflow-y-auto text-sm " + panelStyle}
      >
        <h3 className="mt-0 mb-4 border-b border-white/50 pb-1 font-bold text-base flex justify-between items-center">
          <span>Control via Leader Robot</span>
          <button
            className="ml-2 text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
            onClick={onHide}
            onTouchEnd={onHide}
          >
            ×
          </button>
        </h3>

        {revoluteJoints.length === 0 ? (
          <div className="mt-4 text-center text-gray-400">
            No joints available for leader control.
          </div>
        ) : (
          <>
            <div className="mt-4">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="border-b border-gray-600 pb-1">Joint</th>
                    <th className="border-b border-gray-600 pb-1 text-center pl-4">
                      Angle
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {revoluteJoints.map((j) => (
                    <tr key={j.servoId}>
                      <td className="py-1">{j.name}</td>
                      <td className="py-1  text-center ">
                        {(() => {
                          const angle =
                            angles.find((a) => a.servoId === j.servoId)
                              ?.angle ?? 0;
                          const fixed = angle.toFixed(1);
                          return fixed + "°";
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Latency indicator */}
            {isConnected && loopLatencyMs !== null && (
              <div className="mt-2 text-xs text-gray-400 flex items-center gap-2">
                <span>Loop latency:</span>
                <span className={loopLatencyMs <= 15 ? "text-green-400" : loopLatencyMs <= 30 ? "text-yellow-400" : "text-red-400"}>
                  {loopLatencyMs}ms
                </span>
                <span className="text-gray-500">
                  ({Math.min(Math.round(1000 / Math.max(loopLatencyMs, 1)), 1000)} Hz)
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              {/* Port selector — only visible in Electron when not yet connected */}
              {isElectron && !isConnected && (
                <PortSelector
                  label="Leader Robot Port"
                  value={selectedPort}
                  onChange={setSelectedPort}
                  disabled={connectionStatus !== "idle"}
                />
              )}
              <div className="flex justify-between items-center gap-2">
                {isConnected ? (
                  <button
                    className={`bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded flex-1 ${
                      connectionStatus !== "idle"
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                    onClick={handleDisconnect}
                    disabled={connectionStatus !== "idle"}
                  >
                    {connectionStatus === "disconnecting"
                      ? "Disconnecting..."
                      : "Disconnect Leader Robot"}
                  </button>
                ) : (
                  <button
                    className={`bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded flex-1 ${
                      connectionStatus !== "idle" || (isElectron && !selectedPort)
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                    onClick={handleConnect}
                    disabled={connectionStatus !== "idle" || (isElectron && !selectedPort)}
                  >
                    {connectionStatus === "connecting"
                      ? "Connecting..."
                      : "Connect Leader Robot"}
                  </button>
                )}
                <LeaderConnectionHelpDialog />
              </div>
            </div>
          </>
        )}
      </div>
    </Rnd>
  );
};

export default LeaderControl;
