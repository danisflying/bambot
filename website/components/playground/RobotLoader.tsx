"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { robotConfigMap } from "@/config/robotConfig";
import * as THREE from "three";
import { Html, useProgress } from "@react-three/drei";
import { ControlPanel } from "./keyboardControl/KeyboardControl";
import { useRobotControl } from "@/hooks/useRobotControl";
import { Canvas } from "@react-three/fiber";
import { ChatControl } from "./chatControl/ChatControl";
import LeaderControl from "../playground/leaderControl/LeaderControl";
import { useLeaderRobotControl } from "@/hooks/useLeaderRobotControl";
import { RobotScene } from "./RobotScene";
import KeyboardControlButton from "../playground/controlButtons/KeyboardControlButton";
import ChatControlButton from "../playground/controlButtons/ChatControlButton";
import LeaderControlButton from "../playground/controlButtons/LeaderControlButton";
import RecordButton from "./controlButtons/RecordButton";
import RecordControl from "./recordControl/RecordControl";
import EpisodeButton from "./controlButtons/EpisodeButton";
import PlaybackButton from "./controlButtons/PlaybackButton";
import EpisodeControl from "./episodeControl/EpisodeControl";
import EpisodePlayback from "./episodePlayback/EpisodePlayback";
import {
  getPanelStateFromLocalStorage,
  setPanelStateToLocalStorage,
} from "@/lib/panelSettings";
import { useBambotAPI } from "@/hooks/useBambotAPI";

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
};

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center className="text-4xl text-white">
      {progress} % loaded
    </Html>
  );
}

export default function RobotLoader({ robotName }: RobotLoaderProps) {
  const [jointDetails, setJointDetails] = useState<JointDetails[]>([]);
  const [showControlPanel, setShowControlPanel] = useState(() => {
    const stored = getPanelStateFromLocalStorage("keyboardControl", robotName);
    return stored !== null ? stored : window.innerWidth >= 900;
  });
  const [showLeaderControl, setShowLeaderControl] = useState(() => {
    return getPanelStateFromLocalStorage("leaderControl", robotName) ?? false;
  });
  const [showChatControl, setShowChatControl] = useState(() => {
    return getPanelStateFromLocalStorage("chatControl", robotName) ?? false;
  });
  const [showRecordControl, setShowRecordControl] = useState(() => {
    return getPanelStateFromLocalStorage("recordControl", robotName) ?? false;
  });
  const [showEpisodeControl, setShowEpisodeControl] = useState(() => {
    return getPanelStateFromLocalStorage("episodeControl", robotName) ?? false;
  });
  const [showPlaybackControl, setShowPlaybackControl] = useState(() => {
    return getPanelStateFromLocalStorage("playbackControl", robotName) ?? false;
  });
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
    urdfUrl,
    orbitTarget,
    camera,
    keyboardControlMap,
    compoundMovements,
    systemPrompt,
    urdfInitJointAngles,
  } = config;

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

  // Functions to handle panel state changes and localStorage updates
  const toggleControlPanel = () => {
    setShowControlPanel((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("keyboardControl", newState, robotName);
      return newState;
    });
  };

  const toggleLeaderControl = () => {
    setShowLeaderControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("leaderControl", newState, robotName);
      return newState;
    });
  };

  const toggleChatControl = () => {
    setShowChatControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("chatControl", newState, robotName);
      return newState;
    });
  };

  const toggleRecordControl = () => {
    setShowRecordControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("recordControl", newState, robotName);
      return newState;
    });
  };

  const toggleEpisodeControl = () => {
    setShowEpisodeControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("episodeControl", newState, robotName);
      return newState;
    });
  };

  const togglePlaybackControl = () => {
    setShowPlaybackControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("playbackControl", newState, robotName);
      return newState;
    });
  };

  const hideControlPanel = () => {
    setShowControlPanel(false);
    setPanelStateToLocalStorage("keyboardControl", false, robotName);
  };

  const hideLeaderControl = () => {
    setShowLeaderControl(false);
    setPanelStateToLocalStorage("leaderControl", false, robotName);
  };

  const hideChatControl = () => {
    setShowChatControl(false);
    setPanelStateToLocalStorage("chatControl", false, robotName);
  };

  const hideRecordControl = () => {
    setShowRecordControl(false);
    setPanelStateToLocalStorage("recordControl", false, robotName);
  };

  const hideEpisodeControl = () => {
    setShowEpisodeControl(false);
    setPanelStateToLocalStorage("episodeControl", false, robotName);
  };

  const hidePlaybackControl = () => {
    setShowPlaybackControl(false);
    setPanelStateToLocalStorage("playbackControl", false, robotName);
  };

  // Stable callback for leader→follower sync.  Defined with useCallback so
  // LeaderControl's tick loop effect doesn't restart on every parent render.
  const handleLeaderSync = useCallback(
    (leaderAngles: { servoId: number; angle: number }[]) => {
      const revoluteJoints = jointDetails.filter(
        (j) => j.jointType === "revolute"
      );
      const revoluteServoIds = new Set(
        revoluteJoints.map((j) => j.servoId)
      );
      updateJointsDegrees(
        leaderAngles
          .filter((la) => revoluteServoIds.has(la.servoId))
          .map(({ servoId, angle }) => ({
            servoId,
            value: angle,
          }))
      );
    },
    [jointDetails, updateJointsDegrees]
  );

  return (
    <>
      <Canvas
        shadows
        camera={{
          position: camera.position,
          fov: camera.fov,
        }}
        onCreated={({ scene, gl }) => {
          scene.background = new THREE.Color(0x263238);
          robotCanvasRef.current = gl.domElement;
        }}
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

      <ControlPanel
        show={showControlPanel}
        onHide={hideControlPanel}
        updateJointsSpeed={updateJointsSpeed}
        jointStates={jointStates}
        updateJointDegrees={updateJointDegrees}
        updateJointsDegrees={updateJointsDegrees}
        updateJointSpeed={updateJointSpeed}
        isConnected={isConnected}
        connectRobot={connectRobot}
        disconnectRobot={disconnectRobot}
        keyboardControlMap={keyboardControlMap}
        compoundMovements={compoundMovements}
      />
      <ChatControl
        show={showChatControl}
        onHide={hideChatControl}
        robotName={robotName}
        systemPrompt={systemPrompt}
      />
      {/* LeaderControl overlay */}
      <LeaderControl
        show={showLeaderControl}
        onHide={hideLeaderControl}
        leaderControl={leaderControl}
        jointDetails={jointDetails}
        onSync={handleLeaderSync}
      />

      {/* Record Control overlay */}
      <RecordControl
        show={showRecordControl}
        onHide={hideRecordControl}
        isRecording={isRecording}
        recordData={recordData}
        startRecording={startRecording}
        stopRecording={stopRecording}
        clearRecordData={clearRecordData}
        updateJointsDegrees={updateJointsDegrees}
        updateJointsSpeed={updateJointsSpeed}
        jointDetails={jointDetails}
        leaderControl={{
          isConnected: leaderControl.isConnected,
          disconnectLeader: leaderControl.disconnectLeader,
        }}
      />

      {/* Episode Recorder overlay */}
      <EpisodeControl
        show={showEpisodeControl}
        onHide={hideEpisodeControl}
        leaderControl={{
          isConnected: leaderControl.isConnected,
          getLastPositions: leaderControl.getLastPositions,
          disconnectLeader: leaderControl.disconnectLeader,
        }}
        jointStates={jointStates}
        jointDetails={jointDetails}
        robotName={robotName}
        robotViewCanvas={robotCanvasRef.current}
      />

      {/* Episode Playback overlay */}
      <EpisodePlayback
        show={showPlaybackControl}
        onHide={hidePlaybackControl}
        updateJointsDegrees={updateJointsDegrees}
        jointDetails={jointDetails}
      />

      <div className="absolute bottom-5 left-0 right-0">
        <div className="flex justify-center items-center">
          <div className="flex gap-2 max-w-md">
            <LeaderControlButton
              showControlPanel={showLeaderControl}
              onToggleControlPanel={toggleLeaderControl}
            />
            <KeyboardControlButton
              showControlPanel={showControlPanel}
              onToggleControlPanel={toggleControlPanel}
            />
            <ChatControlButton
              showControlPanel={showChatControl}
              onToggleControlPanel={toggleChatControl}
            />
            <RecordButton
              showControlPanel={showRecordControl}
              onToggleControlPanel={toggleRecordControl}
            />
            <EpisodeButton
              showControlPanel={showEpisodeControl}
              onToggleControlPanel={toggleEpisodeControl}
            />
            <PlaybackButton
              showControlPanel={showPlaybackControl}
              onToggleControlPanel={togglePlaybackControl}
            />
          </div>
        </div>
      </div>
    </>
  );
}
