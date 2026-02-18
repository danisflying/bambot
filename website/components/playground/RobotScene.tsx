"use client";

import { useEffect, useRef, MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import URDFLoader, { URDFRobot, URDFJoint } from "urdf-loader";
import { OrbitControls } from "@react-three/drei";
import { GroundPlane } from "./GroundPlane";
import { robotConfigMap } from "@/config/robotConfig";
import { JointState } from "@/hooks/useRobotControl";
import { degreesToRadians } from "@/lib/utils";

export type JointDetails = {
  name: string;
  servoId: number;
  limit: {
    lower?: number;
    upper?: number;
  };
  jointType: "revolute" | "continuous";
};

type RobotSceneProps = {
  robotName: string;
  urdfUrl: string;
  orbitTarget?: [number, number, number];
  setJointDetails: (details: JointDetails[]) => void;
  jointStates: JointState[];
  /** Ref to a 2D canvas where the wrist-camera view is blitted each frame */
  wristCanvasRef?: MutableRefObject<HTMLCanvasElement | null>;
};

/** Resolution of the off-screen wrist camera render target */
const WRIST_CAM_WIDTH = 640;
const WRIST_CAM_HEIGHT = 480;

export function RobotScene({
  robotName,
  urdfUrl,
  orbitTarget,
  setJointDetails,
  jointStates,
  wristCanvasRef,
}: RobotSceneProps) {
  const { scene, gl } = useThree();
  const robotRef = useRef<URDFRobot | null>(null);

  // Off-screen wrist camera resources (created once, never recreated)
  const wristCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const wristRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const wristPixelBuf = useRef<Uint8Array | null>(null);
  const wristJointRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);

    loader.load(
      urdfUrl,
      (robot) => {
        robotRef.current = robot;

        const config = robotConfigMap[robotName];
        const details: JointDetails[] = robot.joints
          ? Object.values(robot.joints)
              .filter(
                (
                  joint
                ): joint is URDFJoint & {
                  jointType: "revolute" | "continuous";
                } =>
                  joint.jointType === "revolute" ||
                  joint.jointType === "continuous"
              )
              .map((joint) => ({
                name: joint.name,
                servoId: config.jointNameIdMap[joint.name],
                limit: {
                  lower:
                    joint.limit.lower === undefined
                      ? undefined
                      : Number(joint.limit.lower),
                  upper:
                    joint.limit.upper === undefined
                      ? undefined
                      : Number(joint.limit.upper),
                },
                jointType: joint.jointType,
              }))
          : [];
        setJointDetails(details);

        robot.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI / -2);
        robot.traverse((c) => (c.castShadow = true));
        robot.updateMatrixWorld(true);
        const scale = 15;
        robot.scale.set(scale, scale, scale);
        scene.add(robot);

        // ── Setup wrist camera if configured ─────────────────────────
        if (config.wristCameraJoint && robot.joints[config.wristCameraJoint]) {
          const wristJoint = robot.joints[config.wristCameraJoint] as unknown as THREE.Object3D;
          wristJointRef.current = wristJoint;

          // Create off-screen render target
          const rt = new THREE.WebGLRenderTarget(WRIST_CAM_WIDTH, WRIST_CAM_HEIGHT, {
            format: THREE.RGBAFormat,
          });
          wristRTRef.current = rt;
          wristPixelBuf.current = new Uint8Array(WRIST_CAM_WIDTH * WRIST_CAM_HEIGHT * 4);

          // Create a perspective camera and attach it to the wrist joint
          const cam = new THREE.PerspectiveCamera(
            60,
            WRIST_CAM_WIDTH / WRIST_CAM_HEIGHT,
            0.01,
            100
          );
          // Offset slightly so the camera looks "forward" from the wrist
          cam.position.set(0, 0.02, 0);
          cam.lookAt(0, 0.02, 0.1);
          wristJoint.add(cam);
          wristCamRef.current = cam;

          // Prepare the 2D canvas for blitting
          if (wristCanvasRef) {
            const cvs = document.createElement("canvas");
            cvs.width = WRIST_CAM_WIDTH;
            cvs.height = WRIST_CAM_HEIGHT;
            wristCanvasRef.current = cvs;
          }
        }
      },
      undefined,
      (error) => console.error("Error loading URDF:", error)
    );
  }, [robotName, urdfUrl, setJointDetails, wristCanvasRef]);

  // Cleanup wrist render target on unmount
  useEffect(() => {
    return () => {
      wristRTRef.current?.dispose();
      if (wristCamRef.current && wristJointRef.current) {
        wristJointRef.current.remove(wristCamRef.current);
      }
    };
  }, []);

  useFrame((state, delta) => {
    if (robotRef.current && robotRef.current.joints) {
      jointStates.forEach((state) => {
        const jointObj = robotRef.current!.joints[state.name];
        if (jointObj) {
          if (
            state.degrees !== undefined &&
            typeof state.degrees === "number" &&
            jointObj.jointType !== "continuous"
          ) {
            jointObj.setJointValue(degreesToRadians(state.degrees));
          } else if (
            state.speed !== undefined &&
            typeof state.speed === "number" &&
            jointObj.jointType === "continuous"
          ) {
            const currentAngle = Number(jointObj.angle) || 0;
            jointObj.setJointValue(currentAngle + (state.speed * delta) / 500);
          }
        }
      });
    }

    // ── Render wrist camera to off-screen target, then blit to 2D canvas ──
    const wristCam = wristCamRef.current;
    const wristRT = wristRTRef.current;
    const wristCanvas = wristCanvasRef?.current;
    if (wristCam && wristRT && wristCanvas) {
      const currentRT = gl.getRenderTarget();
      gl.setRenderTarget(wristRT);
      gl.render(scene, wristCam);
      gl.setRenderTarget(currentRT);

      // Read pixels and blit to 2D canvas so captureStream / toDataURL work
      const buf = wristPixelBuf.current!;
      gl.readRenderTargetPixels(wristRT, 0, 0, WRIST_CAM_WIDTH, WRIST_CAM_HEIGHT, buf);

      const ctx = wristCanvas.getContext("2d");
      if (ctx) {
        const imgData = ctx.createImageData(WRIST_CAM_WIDTH, WRIST_CAM_HEIGHT);
        // WebGL pixels are bottom-to-top; flip vertically
        for (let y = 0; y < WRIST_CAM_HEIGHT; y++) {
          const srcRow = (WRIST_CAM_HEIGHT - 1 - y) * WRIST_CAM_WIDTH * 4;
          const dstRow = y * WRIST_CAM_WIDTH * 4;
          imgData.data.set(buf.subarray(srcRow, srcRow + WRIST_CAM_WIDTH * 4), dstRow);
        }
        ctx.putImageData(imgData, 0, 0);
      }
    }
  });

  return (
    <>
      <OrbitControls target={orbitTarget || [0, 0.1, 0.1]} />
      <GroundPlane />
      <directionalLight
        castShadow
        intensity={1}
        position={[2, 20, 5]}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight
        intensity={1}
        position={[-2, 20, -5]}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <ambientLight intensity={0.4} />
    </>
  );
}
