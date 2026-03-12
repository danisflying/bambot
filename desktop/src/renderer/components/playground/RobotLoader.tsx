import React, { useEffect, useRef, useState, useCallback, useMemo, Suspense, memo } from "react";
import { robotConfigMap } from "@/config/robotConfig";
import { resolveStaticUrl } from "@/lib/utils";
import * as THREE from "three";
import { Html, useProgress } from "@react-three/drei";
import { ControlPanel } from "./keyboardControl/KeyboardControl";
import { useRobotControl } from "@/hooks/useRobotControl";
import { Canvas } from "@react-three/fiber";
import { ChatControl } from "./chatControl/ChatControl";
import LeaderControl from "../playground/leaderControl/LeaderControl";
import { useLeaderRobotControl } from "@/hooks/useLeaderRobotControl";
import { RobotScene } from "./RobotScene";
import RecordControl from "./recordControl/RecordControl";
import EpisodeControl from "./episodeControl/EpisodeControl";
import EpisodePlayback from "./episodePlayback/EpisodePlayback";
import { useBambotAPI } from "@/hooks/useBambotAPI";
import { Sidebar, SidebarTab, DockRegion } from "./Sidebar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

/** Tracks whether any recording or playback panel is actively running */
function useKeyboardDisabled() {
  const [recordBusy, setRecordBusy] = useState(false);
  const [episodeBusy, setEpisodeBusy] = useState(false);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const disabled = recordBusy || episodeBusy || playbackBusy;
  return { disabled, setRecordBusy, setEpisodeBusy, setPlaybackBusy } as const;
}

export type JointDetails = {
  name: string;
  servoId: number;
  limit: {
    lower?: number;
    upper?: number;
  };
  jointType: "revolute" | "continuous";
};

type RobotLoaderProps = {
  robotName: string;
  onBack: () => void;
};

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center className="text-4xl text-white">
      {progress} % loaded
    </Html>
  );
}

/** Memoized 3D viewport — only re-renders when camera/urdf config changes */
const Viewport = memo(function Viewport({
  camera,
  robotName,
  urdfUrl,
  orbitTarget,
  setJointDetails,
  jointStates,
  onCreated,
}: {
  camera: { position: [number, number, number]; fov: number };
  robotName: string;
  urdfUrl: string;
  orbitTarget: [number, number, number];
  setJointDetails: (d: JointDetails[]) => void;
  jointStates: import("@/hooks/useRobotControl").JointState[];
  onCreated: (state: { scene: THREE.Scene; gl: THREE.WebGLRenderer }) => void;
}) {
  return (
    <Canvas
      shadows
      camera={{ position: camera.position, fov: camera.fov }}
      onCreated={onCreated}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <Suspense fallback={<Loader />}>
        <RobotScene
          robotName={robotName}
          urdfUrl={urdfUrl}
          orbitTarget={orbitTarget}
          setJointDetails={setJointDetails}
          jointStates={jointStates}
        />
      </Suspense>
    </Canvas>
  );
});

export default function RobotLoader({ robotName, onBack }: RobotLoaderProps) {
  const [jointDetails, setJointDetails] = useState<JointDetails[]>([]);

  // ── Multi-region dock state ─────────────────────────────────────────────
  const [tabRegions, setTabRegions] = useState<Record<SidebarTab, DockRegion>>({
    control: "right",
    leader: "right",
    record: "right",
    episodes: "right",
    playback: "right",
    chat: "right",
  });
  const [activePerRegion, setActivePerRegion] = useState<Record<DockRegion, SidebarTab | null>>({
    left: null,
    right: "control",
    bottom: null,
  });
  const [poppedOut, setPoppedOut] = useState<Set<SidebarTab>>(new Set());

  // Derive per-region tab lists (preserves TAB_META order)
  const tabsByRegion = useMemo(() => {
    const result: Record<DockRegion, SidebarTab[]> = { left: [], right: [], bottom: [] };
    for (const [tab, region] of Object.entries(tabRegions)) {
      result[region].push(tab as SidebarTab);
    }
    return result;
  }, [tabRegions]);

  // Ensure active tab is always valid for each region
  const validActive = useMemo(() => {
    const result = { ...activePerRegion };
    for (const region of ["left", "right", "bottom"] as DockRegion[]) {
      const tabs = tabsByRegion[region];
      if (!result[region] || !tabs.includes(result[region]!)) {
        result[region] = tabs[0] ?? null;
      }
    }
    return result;
  }, [tabsByRegion, activePerRegion]);

  const hasLeft = tabsByRegion.left.length > 0;
  const hasRight = tabsByRegion.right.length > 0;
  const hasBottom = tabsByRegion.bottom.length > 0;

  const popOut = useCallback((tab: SidebarTab) => {
    setPoppedOut((prev) => new Set(prev).add(tab));
  }, []);

  const dockBack = useCallback((tab: SidebarTab) => {
    setPoppedOut((prev) => {
      const next = new Set(prev);
      next.delete(tab);
      return next;
    });
    setActivePerRegion((prev) => ({ ...prev, [tabRegions[tab]]: tab }));
  }, [tabRegions]);

  const moveTab = useCallback((tab: SidebarTab, toRegion: DockRegion) => {
    setTabRegions((prev) => ({ ...prev, [tab]: toRegion }));
    setActivePerRegion((prev) => ({ ...prev, [toRegion]: tab }));
  }, []);

  // Track whether keyboard controls should be disabled during recording / playback
  const { disabled: keyboardDisabled, setRecordBusy, setEpisodeBusy, setPlaybackBusy } = useKeyboardDisabled();

  // Ref to the Three.js renderer canvas for robot_view simulated camera
  const robotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const config = robotConfigMap[robotName];

  // Get leader robot servo IDs (exclude continuous joint types)
  const leaderServoIds = jointDetails
    .filter((j) => j.jointType !== "continuous")
    .map((j) => j.servoId);

  // Initialize leader robot control hook
  const leaderControl = useLeaderRobotControl(leaderServoIds);

  if (!config) {
    throw new Error(`Robot configuration for "${robotName}" not found.`);
  }

  const {
    urdfUrl: rawUrdfUrl,
    orbitTarget,
    camera,
    keyboardControlMap,
    compoundMovements,
    systemPrompt,
    urdfInitJointAngles,
  } = config;

  // In production Electron the renderer runs under file://, so relative asset
  // paths must be resolved to an absolute file:// URL.
  const urdfUrl = resolveStaticUrl(rawUrdfUrl);

  const {
    isConnected,
    connectRobot,
    disconnectRobot,
    jointStates,
    updateJointSpeed,
    setJointDetails: updateJointDetails,
    updateJointDegrees,
    updateJointsDegrees,
    updateJointsSpeed,
    isRecording,
    recordData,
    startRecording,
    stopRecording,
    clearRecordData,
  } = useRobotControl(jointDetails, urdfInitJointAngles);

  // Enable BamBot API bridge — polls server for AI agent commands
  useBambotAPI({
    enabled: robotName === "so-arm100",
    isConnected,
    jointStates,
  });

  useEffect(() => {
    updateJointDetails(jointDetails);
  }, [jointDetails, updateJointDetails]);

  // Stable callback for leader→follower sync
  const handleLeaderSync = useCallback(
    (leaderAngles: { servoId: number; angle: number }[]) => {
      const revoluteJoints = jointDetails.filter(
        (j) => j.jointType === "revolute"
      );
      const revoluteServoIds = new Set(revoluteJoints.map((j) => j.servoId));
      updateJointsDegrees(
        leaderAngles
          .filter((la) => revoluteServoIds.has(la.servoId))
          .map(({ servoId, angle }) => ({ servoId, value: angle }))
      );
    },
    [jointDetails, updateJointsDegrees]
  );

  const handleCanvasCreated = useCallback(
    ({ scene, gl }: { scene: THREE.Scene; gl: THREE.WebGLRenderer }) => {
      scene.background = new THREE.Color(0x1a1a2e);
      robotCanvasRef.current = gl.domElement;
    },
    []
  );

  // Noop hide for sidebar mode (tab switching handles visibility)
  const noop = useCallback(() => {}, []);

  // ── Render helpers ────────────────────────────────────────────────────────
  // Centralises panel rendering so each tab's JSX exists once instead of 3×.

  const renderTabContent = (tab: SidebarTab | null, mode: "sidebar" | "floating", onHide: () => void) => {
    if (!tab) return null;
    switch (tab) {
      case "control":
        return (
          <ControlPanel
            show mode={mode} onHide={onHide}
            updateJointsSpeed={updateJointsSpeed} jointStates={jointStates}
            updateJointDegrees={updateJointDegrees} updateJointsDegrees={updateJointsDegrees}
            updateJointSpeed={updateJointSpeed} isConnected={isConnected}
            connectRobot={connectRobot} disconnectRobot={disconnectRobot}
            keyboardControlMap={keyboardControlMap} compoundMovements={compoundMovements}
            keyboardDisabled={keyboardDisabled}
          />
        );
      case "leader":
        return (
          <LeaderControl
            show mode={mode} onHide={onHide}
            leaderControl={leaderControl} jointDetails={jointDetails}
            onSync={handleLeaderSync}
          />
        );
      case "record":
        return (
          <RecordControl
            show mode={mode} onHide={onHide}
            isRecording={isRecording} recordData={recordData}
            startRecording={startRecording} stopRecording={stopRecording}
            clearRecordData={clearRecordData} updateJointsDegrees={updateJointsDegrees}
            updateJointsSpeed={updateJointsSpeed} jointDetails={jointDetails}
            leaderControl={{ isConnected: leaderControl.isConnected, disconnectLeader: leaderControl.disconnectLeader }}
            onBusyChange={setRecordBusy}
          />
        );
      case "episodes":
        return (
          <EpisodeControl
            show mode={mode} onHide={onHide}
            leaderControl={{ isConnected: leaderControl.isConnected, getLastPositions: leaderControl.getLastPositions, disconnectLeader: leaderControl.disconnectLeader }}
            jointStates={jointStates} jointDetails={jointDetails}
            robotName={robotName} robotViewCanvas={robotCanvasRef.current}
            onBusyChange={setEpisodeBusy}
          />
        );
      case "playback":
        return (
          <EpisodePlayback
            show mode={mode} onHide={onHide}
            updateJointsDegrees={updateJointsDegrees} jointDetails={jointDetails}
            onBusyChange={setPlaybackBusy}
          />
        );
      case "chat":
        return (
          <ChatControl
            show mode={mode} onHide={onHide}
            robotName={robotName} systemPrompt={systemPrompt}
          />
        );
      default:
        return null;
    }
  };

  /** Render a dock region's Sidebar + its active panel content */
  const renderDockRegion = (region: DockRegion) => {
    const tabs = tabsByRegion[region];
    const active = validActive[region];
    return (
      <Sidebar
        region={region}
        tabs={tabs}
        activeTab={active}
        onTabChange={(tab) => setActivePerRegion((p) => ({ ...p, [region]: tab }))}
        poppedOut={poppedOut}
        onPopOut={popOut}
        onMoveTab={moveTab}
      >
        {active && !poppedOut.has(active)
          ? renderTabContent(active, "sidebar", noop)
          : null}
      </Sidebar>
    );
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="h-10 flex items-center px-3 border-b border-zinc-800 bg-zinc-950 shrink-0 gap-3 select-none">
        <button
          onClick={onBack}
          className="text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <div className="w-px h-5 bg-zinc-800" />
        <span className="text-sm font-medium text-white">{robotName}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-emerald-400" : "bg-zinc-600"
            }`}
          />
          <span className="text-xs text-zinc-400">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      {/* ── Main Content: multi-region dock layout ─────────── */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical">
          {/* Top row: optional left + viewport + optional right */}
          <ResizablePanel defaultSize={hasBottom ? 70 : 100} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              {hasLeft && (
                <ResizablePanel
                  key="panel-left"
                  defaultSize={hasRight ? 20 : 25}
                  minSize={15}
                  maxSize={40}
                  order={1}
                >
                  {renderDockRegion("left")}
                </ResizablePanel>
              )}
              {hasLeft && <ResizableHandle key="handle-left" />}

              <ResizablePanel key="panel-viewport" order={2} minSize={30}>
                <div className="h-full w-full">
                  <Viewport
                    camera={camera}
                    robotName={robotName}
                    urdfUrl={urdfUrl}
                    orbitTarget={orbitTarget}
                    setJointDetails={setJointDetails}
                    jointStates={jointStates}
                    onCreated={handleCanvasCreated}
                  />
                </div>
              </ResizablePanel>

              {hasRight && <ResizableHandle key="handle-right" />}
              {hasRight && (
                <ResizablePanel
                  key="panel-right"
                  defaultSize={hasLeft ? 25 : 32}
                  minSize={15}
                  maxSize={50}
                  order={3}
                >
                  {renderDockRegion("right")}
                </ResizablePanel>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Optional bottom panel */}
          {hasBottom && <ResizableHandle key="handle-bottom" />}
          {hasBottom && (
            <ResizablePanel
              key="panel-bottom"
              defaultSize={30}
              minSize={12}
              maxSize={50}
            >
              {renderDockRegion("bottom")}
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>

      {/* ── Popped-out floating panels ────────────────────── */}
      {Array.from(poppedOut).map((tab) => (
        <React.Fragment key={tab}>
          {renderTabContent(tab, "floating", () => dockBack(tab))}
        </React.Fragment>
      ))}

      {/* ── Status Bar ─────────────────────────────────────── */}
      <footer className="h-6 flex items-center px-3 border-t border-zinc-800 bg-zinc-950 shrink-0 text-[11px] text-zinc-500 gap-4 select-none">
        <span>{jointDetails.length} joints</span>
        {isRecording && (
          <span className="text-red-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            Recording
          </span>
        )}
        <div className="flex-1" />
        <span>BamBot Desktop</span>
      </footer>
    </div>
  );
}
