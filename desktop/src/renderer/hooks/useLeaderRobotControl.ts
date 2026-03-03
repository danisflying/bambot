import { useState, useCallback, useRef } from "react";
import { ScsServoSDK } from "feetech.js";
import { ElectronPortHandler } from "../lib/ElectronPortHandler";

export function useLeaderRobotControl(servoIds: number[]) {
  const scsServoSDK = useRef(new ScsServoSDK()).current;
  const [isConnected, setIsConnected] = useState(false);
  const [readableServoIds, setReadableServoIds] = useState<number[]>([]);

  // Connect to leader robot.
  // portPath: optional pre-selected serial port path (Electron only).
  // When omitted in Electron the ElectronPortHandler auto-selects the next
  // available port (portIndex: 1 — assumes follower uses index 0).
  const connectLeader = useCallback(async (portPath?: string) => {
    try {
      const isElectron = typeof window !== "undefined" && !!window.electron;
      if (isElectron) {
        await scsServoSDK.connect({
          // Default to portIndex 1 so the leader uses a different port than
          // the follower robot (which defaults to portIndex 0).
          portHandlerFactory: () =>
            new ElectronPortHandler({ portPath, portIndex: portPath ? 0 : 1 }),
        });
      } else {
        await scsServoSDK.connect();
      }
      // Read initial positions to see which servos are readable
      const pos = await scsServoSDK.syncReadPositions(servoIds);
      const readable = Array.from(new Map(pos).keys());

      if (readable.length > 0) {
        try {
          for (const id of readable) {
            //disable torque for all servos
            await scsServoSDK.writeTorqueEnable(id, false);
          }
        } catch (e) {
          console.error(`Error disabling torque for servo:`, e);
        }
      }
      setReadableServoIds(readable);
      setIsConnected(true);
    } catch (e) {
      setIsConnected(false);
      setReadableServoIds([]);
      alert(e);
      throw e;
    }
  }, [servoIds]);

  // Disconnect
  const disconnectLeader = useCallback(async () => {
    try {
      await scsServoSDK.disconnect();
    } finally {
      setIsConnected(false);
      setReadableServoIds([]);
    }
  }, []);

  // Get joint positions (fast mode for low-latency control loops)
  // Uses syncReadPositionsBatch (single GroupSyncRead transaction) instead of
  // syncReadPositions (N sequential reads) to minimise IPC round-trips.
  const getPositions = useCallback(async () => {
    if (!isConnected || readableServoIds.length === 0) return new Map();
    try {
      const pos = await scsServoSDK.syncReadPositionsBatch(readableServoIds, { fast: true });
      return new Map<number, number>(pos);
    } catch (e) {
      console.error("Error reading positions:", e);
      return new Map();
    }
  }, [isConnected, readableServoIds]);

  return {
    isConnected,
    connectLeader,
    disconnectLeader,
    getPositions,
  };
}
