/**
 * useBambotAPI Hook
 *
 * Browser-side consumer for the BamBot API command queue.
 * Polls the server for pending commands and executes them on the
 * connected robot via simulated keyboard events (key_press only).
 *
 * This bridges server-side AI agent API calls to client-side
 * Web Serial robot control — without giving agents direct joint control.
 */

import { useEffect, useRef, useCallback } from "react";
import type { JointState } from "@/hooks/useRobotControl";
import type { Command, JointName } from "@/lib/bambot";

const POLL_INTERVAL_MS = 250; // Poll every 250ms

type UseBambotAPIOptions = {
  /** Whether API command consumption is enabled */
  enabled: boolean;
  /** Whether the physical robot is connected */
  isConnected: boolean;
  /** Current joint states */
  jointStates: JointState[];
};

/**
 * Hook that polls the BamBot API for pending commands and executes them.
 * Syncs robot state back to the server after each command.
 */
export function useBambotAPI({
  enabled,
  isConnected,
  jointStates,
}: UseBambotAPIOptions) {
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const jointStatesRef = useRef(jointStates);
  const isProcessing = useRef(false);

  // Keep the ref in sync with current state
  useEffect(() => {
    jointStatesRef.current = jointStates;
  }, [jointStates]);

  // Sync robot state to the server
  const syncState = useCallback(async () => {
    try {
      const joints = jointStatesRef.current
        .filter((j) => j.jointType === "revolute" && typeof j.degrees === "number")
        .map((j) => ({
          joint_name: j.name as JointName,
          angle: j.degrees as number,
          servo_id: j.servoId ?? 0,
        }));

      await fetch("/api/bambot/v1/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connected: isConnected,
          joints,
        }),
      });
    } catch (error) {
      console.error("[BamBot API] Failed to sync state:", error);
    }
  }, [isConnected]);

  // Execute a single command (key_press only — no direct joint control)
  const executeCommand = useCallback(
    async (command: Command): Promise<{ success: boolean; result: string }> => {
      const { payload } = command;

      try {
        switch (payload.action) {
          case "key_press": {
            const { key, duration_ms } = payload.params;
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true })
            );
            await new Promise((resolve) =>
              setTimeout(resolve, duration_ms || 1000)
            );
            window.dispatchEvent(
              new KeyboardEvent("keyup", { key, bubbles: true })
            );
            return {
              success: true,
              result: `Held key "${key}" for ${duration_ms || 1000}ms`,
            };
          }

          default:
            return {
              success: false,
              result: `Unknown action: ${payload.action}`,
            };
        }
      } catch (error) {
        return {
          success: false,
          result: error instanceof Error ? error.message : "Execution failed",
        };
      }
    },
    []
  );

  // Acknowledge command completion to the server
  const ackCommand = useCallback(
    async (commandId: string, success: boolean, result: string) => {
      try {
        await fetch("/api/bambot/v1/commands/pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command_id: commandId,
            status: success ? "completed" : "failed",
            result,
          }),
        });
      } catch (error) {
        console.error("[BamBot API] Failed to ack command:", error);
      }
    },
    []
  );

  // Poll for pending commands and process them
  const pollAndProcess = useCallback(async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;

    try {
      const response = await fetch("/api/bambot/v1/commands/pending");
      const data = await response.json();

      if (data.success && data.data?.commands?.length > 0) {
        for (const command of data.data.commands) {
          const result = await executeCommand(command);
          await ackCommand(command.id, result.success, result.result);
        }

        // Sync state after executing commands
        await syncState();
      }
    } catch (error) {
      // Silently ignore poll errors to avoid spamming console
    } finally {
      isProcessing.current = false;
    }
  }, [executeCommand, ackCommand, syncState]);

  // Start/stop polling based on enabled flag
  useEffect(() => {
    if (!enabled) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // Initial state sync
    syncState();

    // Start polling
    pollingRef.current = setInterval(pollAndProcess, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [enabled, pollAndProcess, syncState]);
}
