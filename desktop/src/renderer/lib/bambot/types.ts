/**
 * BamBot API Types
 *
 * Core type definitions for the BamBot API that allows AI agents
 * to control robots via tool calls.
 */

// ─── Joint & Robot Types ──────────────────────────────────────────────

export type JointName =
  | "Rotation"
  | "Pitch"
  | "Elbow"
  | "Wrist_Pitch"
  | "Wrist_Roll"
  | "Jaw";

export const JOINT_NAMES: JointName[] = [
  "Rotation",
  "Pitch",
  "Elbow",
  "Wrist_Pitch",
  "Wrist_Roll",
  "Jaw",
];

export const JOINT_NAME_TO_SERVO_ID: Record<JointName, number> = {
  Rotation: 1,
  Pitch: 2,
  Elbow: 3,
  Wrist_Pitch: 4,
  Wrist_Roll: 5,
  Jaw: 6,
};

export const SERVO_ID_TO_JOINT_NAME: Record<number, JointName> = {
  1: "Rotation",
  2: "Pitch",
  3: "Elbow",
  4: "Wrist_Pitch",
  5: "Wrist_Roll",
  6: "Jaw",
};

export type JointPosition = {
  joint_name: JointName;
  angle: number; // 0-360 degrees
  servo_id: number;
};

export type RobotState = {
  robot_id: string;
  connected: boolean;
  joints: JointPosition[];
  timestamp: number;
};

// ─── Command Types ────────────────────────────────────────────────────

export type CommandStatus = "pending" | "executing" | "completed" | "failed";

export type KeyPressCommand = {
  action: "key_press";
  params: {
    key: string;
    duration_ms: number;
  };
};

export type GetRobotStateCommand = {
  action: "get_robot_state";
  params?: Record<string, never>;
};

export type CommandPayload = KeyPressCommand | GetRobotStateCommand;

export type Command = {
  id: string;
  robot_id: string;
  status: CommandStatus;
  payload: CommandPayload;
  result?: string;
  created_at: number;
  completed_at?: number;
};

// ─── API Response Types ───────────────────────────────────────────────

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type CommandResponse = {
  command_id: string;
  status: CommandStatus;
  message: string;
};

export type PendingCommandsResponse = {
  commands: Command[];
};

export type AckCommandResponse = {
  command_id: string;
  status: CommandStatus;
};

// ─── Tool Definition Types (OpenAI Function Calling Format) ───────────

export type ToolParameterProperty = {
  type: string;
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: number;
  items?: {
    type: string;
    properties?: Record<string, ToolParameterProperty>;
    required?: string[];
  };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterProperty>;
      required: string[];
    };
  };
};
