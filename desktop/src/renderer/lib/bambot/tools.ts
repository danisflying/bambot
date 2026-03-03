/**
 * BamBot API - Tool Definitions
 *
 * OpenAI-compatible function calling tool definitions for AI agents
 * to control the so-arm100 robot.
 */

import { ToolDefinition } from "./types";

export const BAMBOT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_robot_state",
      description:
        "Get the current state of the so-arm100 robot arm, including all joint angles and connection status.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "key_press",
      description:
        "Simulate a keyboard key press to control the robot. The key is held for a duration then released. Multiple keys can be pressed sequentially to compose movements. Keys: q/1 (rotate left/right), i/8 (jaw down/up), u/o (jaw backward/forward), 6/y (open/close jaw), t/5 (rotate jaw wrist roll).",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "The keyboard key to press. Available keys: 'q' (rotate left), '1' (rotate right), 'i' (move jaw/arm down), '8' (move jaw/arm up), 'u' (move jaw backward), 'o' (move jaw forward), '6' (open jaw/gripper), 'y' (close jaw/gripper), 't' (wrist roll one direction), '5' (wrist roll other direction).",
          },
          duration_ms: {
            type: "number",
            description:
              "How long to hold the key in milliseconds. Longer durations produce larger movements. Use short durations (200-500ms) for fine adjustments and longer durations (1000-3000ms) for large movements.",
            minimum: 100,
            maximum: 5000,
            default: 1000,
          },
        },
        required: ["key"],
      },
    },
  },
];

/**
 * Returns tool definitions formatted for OpenAI / Anthropic / other LLM providers.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return BAMBOT_TOOLS;
}

/**
 * Returns a system prompt that describes the robot and available tools.
 */
export function getSystemPrompt(): string {
  return `You are an AI agent controlling a so-arm100 robot arm via simulated keyboard key presses. The robot has 6 joints:

1. **Rotation** (Servo 1) - Base rotation. 180° is center.
2. **Pitch** (Servo 2) - Shoulder pitch. 180° is center.
3. **Elbow** (Servo 3) - Elbow bend. 180° is center.
4. **Wrist_Pitch** (Servo 4) - Wrist pitch. 180° is center.
5. **Wrist_Roll** (Servo 5) - Wrist roll. 180° is center.
6. **Jaw** (Servo 6) - Gripper. ~240° is open, ~130° is closed.

You control the robot by pressing keyboard keys using the **key_press** tool. Each key press holds the key for a duration, producing incremental movement. Longer duration = larger movement.

Available keys:
- **"q"** — Rotate base LEFT
- **"1"** — Rotate base RIGHT
- **"i"** — Move arm/jaw DOWN
- **"8"** — Move arm/jaw UP
- **"u"** — Move arm/jaw BACKWARD
- **"o"** — Move arm/jaw FORWARD
- **"6"** — OPEN jaw/gripper
- **"y"** — CLOSE jaw/gripper
- **"t"** — Wrist roll (one direction)
- **"5"** — Wrist roll (other direction)

You can also use **get_robot_state** to check current joint angles and connection status.

Tips:
- Use short durations (200-500ms) for fine adjustments
- Use longer durations (1000-3000ms) for large movements
- Chain multiple key_press calls to compose complex movements
- Check get_robot_state between sequences to verify progress
- The jaw must be opened before grasping and closed to grip objects`;
}
