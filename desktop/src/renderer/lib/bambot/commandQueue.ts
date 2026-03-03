/**
 * BamBot API - Command Queue
 *
 * Server-side in-memory command queue and robot state manager.
 * Bridges AI agent API calls to the browser-side robot controller.
 *
 * Flow: AI Agent → POST /api/bambot/v1/command → CommandQueue → Browser polls → Robot executes
 */

import {
  Command,
  CommandPayload,
  CommandStatus,
  RobotState,
  JointPosition,
  JOINT_NAMES,
  JOINT_NAME_TO_SERVO_ID,
} from "./types";

// ─── ID Generation ────────────────────────────────────────────────────

let commandCounter = 0;

function generateCommandId(): string {
  commandCounter++;
  return `cmd_${Date.now()}_${commandCounter}`;
}

// ─── In-Memory Store ──────────────────────────────────────────────────

/** Pending/active commands waiting to be consumed by the browser client */
const commandQueue: Command[] = [];

/** Completed/failed commands (kept for status lookups, limited to last 100) */
const commandHistory: Command[] = [];

const MAX_HISTORY = 100;
const COMMAND_TTL_MS = 60_000; // Commands expire after 60 seconds

/** Current robot state as reported by the browser client */
let currentRobotState: RobotState = {
  robot_id: "so-arm100",
  connected: false,
  joints: JOINT_NAMES.map((name) => ({
    joint_name: name,
    angle: 180,
    servo_id: JOINT_NAME_TO_SERVO_ID[name],
  })),
  timestamp: Date.now(),
};

// ─── Command Queue Operations ─────────────────────────────────────────

/**
 * Enqueue a new command from an AI agent.
 */
export function enqueueCommand(
  robotId: string,
  payload: CommandPayload
): Command {
  // Clean up expired pending commands
  cleanupExpiredCommands();

  const command: Command = {
    id: generateCommandId(),
    robot_id: robotId,
    status: "pending",
    payload,
    created_at: Date.now(),
  };

  commandQueue.push(command);
  return command;
}

/**
 * Get all pending commands for the browser client to consume.
 */
export function getPendingCommands(robotId: string): Command[] {
  cleanupExpiredCommands();
  return commandQueue.filter(
    (cmd) => cmd.robot_id === robotId && cmd.status === "pending"
  );
}

/**
 * Mark a command as executing (browser client has picked it up).
 */
export function markCommandExecuting(commandId: string): Command | null {
  const cmd = commandQueue.find((c) => c.id === commandId);
  if (cmd) {
    cmd.status = "executing";
    return cmd;
  }
  return null;
}

/**
 * Mark a command as completed or failed.
 */
export function completeCommand(
  commandId: string,
  status: "completed" | "failed",
  result?: string
): Command | null {
  const idx = commandQueue.findIndex((c) => c.id === commandId);
  if (idx === -1) return null;

  const cmd = commandQueue[idx];
  cmd.status = status;
  cmd.result = result;
  cmd.completed_at = Date.now();

  // Move from queue to history
  commandQueue.splice(idx, 1);
  commandHistory.push(cmd);

  // Trim history
  while (commandHistory.length > MAX_HISTORY) {
    commandHistory.shift();
  }

  return cmd;
}

/**
 * Get command status by ID.
 */
export function getCommandStatus(commandId: string): Command | null {
  return (
    commandQueue.find((c) => c.id === commandId) ||
    commandHistory.find((c) => c.id === commandId) ||
    null
  );
}

/**
 * Clean up expired pending commands.
 */
function cleanupExpiredCommands(): void {
  const now = Date.now();
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    if (
      commandQueue[i].status === "pending" &&
      now - commandQueue[i].created_at > COMMAND_TTL_MS
    ) {
      const expired = commandQueue.splice(i, 1)[0];
      expired.status = "failed";
      expired.result = "Command expired (not consumed within 60s)";
      expired.completed_at = now;
      commandHistory.push(expired);
    }
  }
}

// ─── Robot State Operations ───────────────────────────────────────────

/**
 * Update robot state (called by browser client).
 */
export function updateRobotState(state: Partial<RobotState>): RobotState {
  currentRobotState = {
    ...currentRobotState,
    ...state,
    timestamp: Date.now(),
  };
  return currentRobotState;
}

/**
 * Update joint positions in the robot state.
 */
export function updateJointPositions(joints: JointPosition[]): RobotState {
  const updatedJoints = [...currentRobotState.joints];
  for (const update of joints) {
    const idx = updatedJoints.findIndex(
      (j) => j.joint_name === update.joint_name
    );
    if (idx !== -1) {
      updatedJoints[idx] = update;
    }
  }
  currentRobotState = {
    ...currentRobotState,
    joints: updatedJoints,
    timestamp: Date.now(),
  };
  return currentRobotState;
}

/**
 * Get current robot state.
 */
export function getRobotState(): RobotState {
  return { ...currentRobotState };
}

/**
 * Set robot connection status.
 */
export function setRobotConnected(connected: boolean): void {
  currentRobotState = {
    ...currentRobotState,
    connected,
    timestamp: Date.now(),
  };
}

// ─── Validation ───────────────────────────────────────────────────────

/**
 * Validate a command payload. Returns null if valid, or an error message.
 */
export function validateCommand(payload: CommandPayload): string | null {
  switch (payload.action) {
    case "key_press": {
      if (!payload.params.key) {
        return "key is required.";
      }
      const validKeys = ["q", "1", "i", "8", "u", "o", "6", "y", "t", "5"];
      if (!validKeys.includes(payload.params.key)) {
        return `Invalid key: '${payload.params.key}'. Valid keys: ${validKeys.join(", ")}`;
      }
      const duration = payload.params.duration_ms;
      if (duration !== undefined && (duration < 100 || duration > 5000)) {
        return `duration_ms must be between 100 and 5000. Got: ${duration}`;
      }
      return null;
    }

    case "get_robot_state":
      return null;

    default:
      return `Unknown command action: ${(payload as CommandPayload).action}. Only 'key_press' and 'get_robot_state' are supported.`;
  }
}
