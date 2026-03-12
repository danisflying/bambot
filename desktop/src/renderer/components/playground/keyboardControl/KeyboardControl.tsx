import React, { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import {
  JointState,
  UpdateJointDegrees,
  UpdateJointsDegrees,
  UpdateJointSpeed,
  UpdateJointsSpeed, // Add UpdateJointsSpeed type
} from "../../../hooks/useRobotControl"; // Adjusted import path
import { RevoluteJointsTable } from "./RevoluteJointsTable"; // Updated import path
import { ContinuousJointsTable } from "./ContinuousJointsTable"; // Updated import path
import { RobotConfig } from "@/config/robotConfig";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { RobotConnectionHelpDialog } from "./RobotConnectionHelpDialog";
import { PortSelector } from "../controlButtons/PortSelector";

// const baudRate = 1000000; // Define baud rate for serial communication - Keep if needed elsewhere, remove if only for UI

// --- Control Panel Component ---
type ControlPanelProps = {
  jointStates: JointState[];
  updateJointDegrees: UpdateJointDegrees;
  updateJointsDegrees: UpdateJointsDegrees;
  updateJointSpeed: UpdateJointSpeed;
  updateJointsSpeed: UpdateJointsSpeed;
  isConnected: boolean;
  connectRobot: (portPath?: string) => void | Promise<void>;
  disconnectRobot: () => void | Promise<void>;
  keyboardControlMap: RobotConfig["keyboardControlMap"];
  compoundMovements?: RobotConfig["compoundMovements"];
  onHide?: () => void;
  show?: boolean;
  /** Disable keyboard input during recording / playback */
  keyboardDisabled?: boolean;
  /** Render inline in sidebar instead of floating Rnd panel */
  mode?: "floating" | "sidebar";
};

export function ControlPanel({
  show = true,
  onHide,
  jointStates,
  updateJointDegrees,
  updateJointsDegrees,
  updateJointSpeed,
  updateJointsSpeed,
  isConnected,
  connectRobot,
  disconnectRobot,
  keyboardControlMap,
  compoundMovements,
  keyboardDisabled = false,
  mode = "floating",
}: ControlPanelProps) {
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "disconnecting"
  >("idle");
  const [ref, bounds] = useMeasure();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);

  // Phase 1 — Electron native serial port selection
  const isElectron = typeof window !== "undefined" && !!window.electron;
  const [selectedPort, setSelectedPort] = useState<string | null>(null);

  useEffect(() => {
    if (bounds.height > 0 && !hasDragged) {
      setPosition((pos) => ({
        ...pos,
        x: window.innerWidth - bounds.width - 20,
        y: window.innerHeight - bounds.height - 20,
      }));
    }
  }, [bounds.height, hasDragged]);

  const handleConnect = async () => {
    setConnectionStatus("connecting");
    try {
      await connectRobot(isElectron ? (selectedPort ?? undefined) : undefined);
    } finally {
      setConnectionStatus("idle");
    }
  };

  const handleDisconnect = async () => {
    setConnectionStatus("disconnecting");
    try {
      await disconnectRobot();
    } finally {
      setConnectionStatus("idle");
    }
  };

  // Separate jointStates into revolute and continuous categories
  const revoluteJoints = jointStates.filter(
    (state) => state.jointType === "revolute"
  );
  const continuousJoints = jointStates.filter(
    (state) => state.jointType === "continuous"
  );

  const panelContent = (
    <>
      {revoluteJoints.length > 0 && (
        <RevoluteJointsTable
          joints={revoluteJoints}
          updateJointDegrees={updateJointDegrees}
          updateJointsDegrees={updateJointsDegrees}
          keyboardControlMap={keyboardControlMap}
          compoundMovements={compoundMovements}
          disabled={keyboardDisabled}
        />
      )}

      {continuousJoints.length > 0 && (
        <ContinuousJointsTable
          joints={continuousJoints}
          updateJointSpeed={updateJointSpeed}
          updateJointsSpeed={updateJointsSpeed}
          disabled={keyboardDisabled}
        />
      )}

      <div className="mt-4 flex flex-col gap-2">
        {isElectron && !isConnected && (
          <PortSelector
            label="Follower Robot Port"
            value={selectedPort}
            onChange={setSelectedPort}
            disabled={connectionStatus !== "idle"}
          />
        )}
        <div className="flex justify-between items-center gap-2">
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={connectionStatus !== "idle" || (isElectron && !isConnected && !selectedPort)}
            className={`text-white text-sm px-3 py-1.5 rounded flex-1 ${
              isConnected
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500"
            } ${
              connectionStatus !== "idle" || (isElectron && !isConnected && !selectedPort)
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            {connectionStatus === "connecting"
              ? "Connecting..."
              : connectionStatus === "disconnecting"
              ? "Disconnecting..."
              : isConnected
              ? "Disconnect Robot"
              : "Connect Follower Robot"}
          </button>
          <RobotConnectionHelpDialog />
        </div>
      </div>
    </>
  );

  // ── Sidebar mode: render inline without Rnd wrapper ──
  if (mode === "sidebar") {
    if (!show) return null;
    return (
      <div className="p-3 text-sm text-white overflow-y-auto h-full">
        {panelContent}
      </div>
    );
  }

  // ── Floating mode (original) ──
  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => {
        setPosition({ x: d.x, y: d.y });
        setHasDragged(true);
      }}
      bounds="window"
      className="z-50"
      style={{ display: show ? undefined : "none" }}
      cancel="input,select,textarea,button,a,option"
    >
      <div
        ref={ref}
        className={"max-h-[80vh] overflow-y-auto text-sm " + panelStyle}
      >
        <h3 className="mt-0 mb-4 border-b border-white/50 pb-1 font-bold text-base flex justify-between items-center">
          <span>Joint Controls</span>
          <button
            onClick={onHide}
            onTouchEnd={onHide}
            className="ml-2 text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
          >
            ×
          </button>
        </h3>
        {panelContent}
      </div>
    </Rnd>
  );
}
