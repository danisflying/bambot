# Integrating the BamBot API into an AI Agent Step Loop

This guide shows how to integrate the BamBot API into any AI agent that uses a tool-calling / function-calling step loop — the standard pattern used by OpenAI, Anthropic, LangChain, CrewAI, and similar frameworks.

> **Important:** The BamBot API does **not** provide direct joint/angle control. All robot movement is done through simulated keyboard key presses (`key_press` tool), which produce incremental movements. This keeps the agent's control interface safe and consistent with the browser UI.

---

## Overview

The BamBot API provides:

1. **Tool definitions** describing available actions (auto-discoverable at `/api/bambot/v1/tools`)
2. **`key_press`** — simulate a key hold to produce incremental movement
3. **`get_robot_state`** — read current joint angles and connection status

Your agent loop fetches the tools, passes them to the LLM, and when the LLM calls a tool, you dispatch it to the BamBot API.

---

## Prerequisites

1. The BamBot website running locally: `cd website && pnpm dev`
2. A browser tab open to `http://localhost:3000/play/so-arm100` (this is the robot controller)
3. Optionally, a physical so-arm100 robot connected via USB

---

## Quick Start — Python

### 1. Install dependencies

```bash
pip install openai requests
```

### 2. Fetch tools & system prompt from BamBot API

```python
import requests

BAMBOT_API = "http://localhost:3000/api/bambot/v1"

# Discover available tools
resp = requests.get(f"{BAMBOT_API}/tools")
data = resp.json()["data"]

tools = data["tools"]           # OpenAI function calling format
system_prompt = data["system_prompt"]
```

### 3. Build the Agent Step Loop

```python
from openai import OpenAI
import requests, json, time

client = OpenAI()  # uses OPENAI_API_KEY env var
BAMBOT_API = "http://localhost:3000/api/bambot/v1"


def fetch_tools():
    """Fetch tool definitions from BamBot API."""
    resp = requests.get(f"{BAMBOT_API}/tools")
    data = resp.json()["data"]
    return data["tools"], data["system_prompt"]


def execute_tool(tool_name: str, arguments: dict) -> str:
    """Execute a tool call by dispatching to the BamBot API."""

    # Both tools go through the command endpoint
    payload = {"action": tool_name, "params": arguments}
    resp = requests.post(f"{BAMBOT_API}/command", json=payload)
    result = resp.json()

    if not result["success"]:
        return f"Error: {result['error']}"

    # get_robot_state returns data directly (no queuing)
    if tool_name == "get_robot_state":
        return json.dumps(result["data"])

    # key_press is queued — poll for completion
    command_id = result["data"]["command_id"]
    for _ in range(20):  # up to 10 seconds
        time.sleep(0.5)
        status_resp = requests.get(f"{BAMBOT_API}/command", params={"id": command_id})
        status = status_resp.json()["data"]
        if status["status"] in ("completed", "failed"):
            return status.get("result", status["status"])

    return "Command timed out waiting for execution."


def run_agent(user_message: str):
    """Run a single agent conversation turn with tool use."""

    tools, system_prompt = fetch_tools()

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    # Step loop: keep calling the LLM until it stops requesting tools
    while True:
        response = client.chat.completions.create(
            model="gpt-4.1-nano",
            messages=messages,
            tools=tools,
        )

        choice = response.choices[0]

        # If the model wants to call tools
        if choice.finish_reason == "tool_calls" or choice.message.tool_calls:
            # Add the assistant message (with tool calls) to history
            messages.append(choice.message)

            # Execute each tool call
            for tool_call in choice.message.tool_calls:
                fn_name = tool_call.function.name
                fn_args = json.loads(tool_call.function.arguments)

                print(f"  🔧 Calling: {fn_name}({fn_args})")
                result = execute_tool(fn_name, fn_args)
                print(f"  ✅ Result: {result}")

                # Add tool result to messages
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

        else:
            # Model is done — return the final text response
            print(f"\n🤖 Agent: {choice.message.content}")
            return choice.message.content


# --- Run it ---
if __name__ == "__main__":
    run_agent("Move the arm down and then open the gripper")
```

---

## Quick Start — TypeScript / Node.js

```typescript
import OpenAI from "openai";

const BAMBOT_API = "http://localhost:3000/api/bambot/v1";
const client = new OpenAI();

async function fetchTools() {
  const resp = await fetch(`${BAMBOT_API}/tools`);
  const { data } = await resp.json();
  return { tools: data.tools, systemPrompt: data.system_prompt };
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${BAMBOT_API}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, params: args }),
  });
  const result = await resp.json();
  if (!result.success) return `Error: ${result.error}`;

  // get_robot_state returns data directly
  if (name === "get_robot_state") {
    return JSON.stringify(result.data);
  }

  // key_press is queued — poll for completion
  const commandId = result.data.command_id;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const statusResp = await fetch(`${BAMBOT_API}/command?id=${commandId}`);
    const status = await statusResp.json();
    if (["completed", "failed"].includes(status.data?.status)) {
      return status.data.result || status.data.status;
    }
  }
  return "Command timed out";
}

async function runAgent(userMessage: string) {
  const { tools, systemPrompt } = await fetchTools();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  while (true) {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-nano",
      messages,
      tools,
    });

    const choice = response.choices[0];

    if (choice.message.tool_calls?.length) {
      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        const fnName = toolCall.function.name;
        const fnArgs = JSON.parse(toolCall.function.arguments);
        console.log(`  🔧 ${fnName}(${JSON.stringify(fnArgs)})`);

        const result = await executeTool(fnName, fnArgs);
        console.log(`  ✅ ${result}`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    } else {
      console.log(`\n🤖 Agent: ${choice.message.content}`);
      return choice.message.content;
    }
  }
}

runAgent("Move the arm down and open the gripper");
```

---

## Integration with Anthropic Claude

```python
import anthropic, requests, json, time

client = anthropic.Anthropic()  # uses ANTHROPIC_API_KEY env var
BAMBOT_API = "http://localhost:3000/api/bambot/v1"


def fetch_tools_anthropic():
    resp = requests.get(f"{BAMBOT_API}/tools", params={"format": "anthropic"})
    data = resp.json()["data"]
    return data["tools"], data["system_prompt"]


def execute_tool(name: str, arguments: dict) -> str:
    resp = requests.post(
        f"{BAMBOT_API}/command",
        json={"action": name, "params": arguments},
    )
    result = resp.json()
    if not result["success"]:
        return f"Error: {result['error']}"

    if name == "get_robot_state":
        return json.dumps(result["data"])

    command_id = result["data"]["command_id"]
    for _ in range(20):
        time.sleep(0.5)
        status = requests.get(f"{BAMBOT_API}/command", params={"id": command_id}).json()
        if status["data"]["status"] in ("completed", "failed"):
            return status["data"].get("result", status["data"]["status"])
    return "Timed out"


def run_agent(user_message: str):
    tools, system_prompt = fetch_tools_anthropic()

    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=system_prompt,
            tools=tools,
            messages=messages,
        )

        # Check if the model wants to use tools
        if response.stop_reason == "tool_use":
            # Add assistant response to messages
            messages.append({"role": "assistant", "content": response.content})

            # Process each tool use block
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    print(f"  🔧 {block.name}({json.dumps(block.input)})")
                    result = execute_tool(block.name, block.input)
                    print(f"  ✅ {result}")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            messages.append({"role": "user", "content": tool_results})

        else:
            # Final text response
            text = "".join(b.text for b in response.content if hasattr(b, "text"))
            print(f"\n🤖 Agent: {text}")
            return text


run_agent("Wave the robot arm left and right")
```

---

## Integration with LangChain

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
import requests, json, time

BAMBOT_API = "http://localhost:3000/api/bambot/v1"


def _send_command(action: str, params: dict = {}) -> str:
    resp = requests.post(f"{BAMBOT_API}/command", json={"action": action, "params": params})
    result = resp.json()
    if not result["success"]:
        return f"Error: {result['error']}"

    if action == "get_robot_state":
        return json.dumps(result["data"])

    cmd_id = result["data"]["command_id"]
    for _ in range(20):
        time.sleep(0.5)
        s = requests.get(f"{BAMBOT_API}/command", params={"id": cmd_id}).json()
        if s["data"]["status"] in ("completed", "failed"):
            return s["data"].get("result", s["data"]["status"])
    return "Timed out"


@tool
def key_press(key: str, duration_ms: int = 1000) -> str:
    """Simulate a keyboard key press to control the so-arm100 robot.
    Available keys: q (rotate left), 1 (rotate right), i (down), 8 (up),
    u (backward), o (forward), 6 (open jaw), y (close jaw), t/5 (wrist roll).
    duration_ms controls how long the key is held (100-5000ms)."""
    return _send_command("key_press", {"key": key, "duration_ms": duration_ms})


@tool
def get_robot_state() -> str:
    """Get current robot joint positions and connection status."""
    return _send_command("get_robot_state")


# Build the agent
tools = [key_press, get_robot_state]
llm = ChatOpenAI(model="gpt-4.1-nano").bind_tools(tools)

# Use in a LangGraph agent or simple loop
from langgraph.prebuilt import create_react_agent
agent = create_react_agent(llm, tools)

result = agent.invoke({"messages": [{"role": "user", "content": "Move the arm down and open the gripper"}]})
```

---

## The Step Loop Pattern

Every agent integration follows this pattern:

```
┌─────────────────────────────────────────────────┐
│                  Agent Loop                      │
│                                                  │
│  1. User sends a message                         │
│  2. LLM receives message + tool definitions      │
│  3. LLM decides to call a tool                   │
│     ├─ get_robot_state → POST /command (inline)  │
│     └─ key_press       → POST /command (queued)  │
│  4. Wait for command completion (poll status)     │
│  5. Return tool result to LLM                    │
│  6. LLM may call more tools → go to step 3       │
│  7. LLM returns final text → done                │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Key points:

- **`get_robot_state`** is handled inline by the API — returns current joint angles immediately
- **`key_press`** is queued and executed by the browser client via simulated keyboard events
- **No direct joint control** — the agent cannot set specific angles; it controls through incremental key presses
- **Poll for completion**: After sending a `key_press` command, poll `GET /api/bambot/v1/command?id=<id>` until `status` is `completed` or `failed`
- **Tool definitions are auto-discoverable**: Fetch from `GET /api/bambot/v1/tools` instead of hardcoding

---

## Tips for Robust Integration

### 1. Handle command timeouts

Commands expire after 60 seconds if the browser client isn't running. Always implement a timeout in your polling loop.

### 2. Check robot state before acting

Call `get_robot_state` first to understand current joint positions. This helps the LLM make better movement decisions.

### 3. Use the system prompt

The `/tools` endpoint returns a `system_prompt` tailored for robot control. Pass it as your agent's system message for best results.

### 4. Use incremental key presses for precision

For precise positioning, instruct the agent to use short `key_press` durations (200-300ms) and check `get_robot_state` between moves. For large movements, use longer durations (1000-3000ms).

### 5. Browser tab must be open

The physical robot (and 3D visualization) is controlled from the browser. Ensure `http://localhost:3000/play/so-arm100` is open in a browser tab.

---

## Example Prompts

Try these with your agent:

- "Move the arm down and open the gripper"
- "Wave left and right"
- "Lower the arm forward, open the jaw, then close it"
- "Rotate the base to the left and then back to the right"
- "What position is the robot currently in?"
- "Move the arm up slowly, checking the position every step"
