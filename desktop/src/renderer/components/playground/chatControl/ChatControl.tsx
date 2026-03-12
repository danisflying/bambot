import React, { useState, useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { SettingsModal } from "./SettingsModal";
import { z } from "zod";
import {
  getApiKeyFromLocalStorage,
  getBaseURLFromLocalStorage,
  getSystemPromptFromLocalStorage,
  getModelFromLocalStorage,
} from "../../../lib/chatSettings";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";

type ChatControlProps = {
  robotName?: string;
  systemPrompt?: string;
  onHide: () => void;
  show?: boolean;
  /** Render inline in sidebar instead of floating Rnd panel */
  mode?: "floating" | "sidebar";
};

export function ChatControl({
  robotName,
  systemPrompt: configSystemPrompt,
  onHide,
  show = true,
  mode = "floating",
}: ChatControlProps) {
  const [ref, bounds] = useMeasure();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>(
    []
  );
  const [showSettings, setShowSettings] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const apiKey = getApiKeyFromLocalStorage();
  const baseURL = getBaseURLFromLocalStorage() || "https://api.openai.com/v1/";
  const model = getModelFromLocalStorage() || "gpt-4.1-nano";
  const systemPrompt =
    getSystemPromptFromLocalStorage(robotName) ||
    configSystemPrompt || // <-- Use configSystemPrompt if present
    `You can help control a robot by pressing keyboard keys. Use the keyPress tool to simulate key presses. Each key will be held down for 1 second by default. If the user describes roughly wanting to make it longer or shorter, adjust the duration accordingly.`;

  // Create openai instance with current apiKey and baseURL
  const openai = createOpenAI({
    apiKey,
    baseURL,
  });

  useEffect(() => {
    if (bounds.height > 0) {
      setPosition((pos) => ({
        ...pos,
        x: window.innerWidth - bounds.width - 20,
        y: 70,
      }));
    }
  }, [bounds.height]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleCommand = async (command: string) => {
    setMessages((prev) => [...prev, { sender: "User", text: command }]);
    try {
      const result = await generateText({
        model: openai(model),
        prompt: command,
        system: systemPrompt,
        tools: {
          keyPress: tool({
            description:
              "Press and hold a keyboard key for a specified duration (in milliseconds) to control the robot",
            parameters: z.object({
              key: z
                .string()
                .describe(
                  "The key to press (e.g., 'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight')"
                ),
              duration: z
                .number()
                .int()
                .min(100)
                .max(5000)
                .default(1000)
                .describe(
                  "How long to hold the key in milliseconds (default: 1000, min: 100, max: 5000)"
                ),
            }),
            execute: async ({
              key,
              duration,
            }: {
              key: string;
              duration?: number;
            }) => {
              const holdTime = duration ?? 1000;
              const keydownEvent = new KeyboardEvent("keydown", {
                key,
                bubbles: true,
              });
              window.dispatchEvent(keydownEvent);

              // Wait for the specified duration
              await new Promise((resolve) => setTimeout(resolve, holdTime));

              // Simulate keyup event
              const keyupEvent = new KeyboardEvent("keyup", {
                key,
                bubbles: true,
              });
              window.dispatchEvent(keyupEvent);
              return `Held key "${key.toUpperCase()}" for ${holdTime} ms`;
            },
          }),
        },
      });
      let text = result.text.trim();
      const content = result.response?.messages[1]?.content;
      for (const element of content ?? []) {
        text += `\n\n${element.result}`;
      }
      setMessages((prev) => [...prev, { sender: "AI", text }]);
    } catch (error) {
      console.error("Error generating text:", error);
      setMessages((prev) => [
        ...prev,
        { sender: "AI", text: "Error: Unable to process your request." },
      ]);
    }
  };

  const handleSend = () => {
    if (input.trim()) {
      if (!apiKey) {
        setShowSettings(true);
        return;
      }
      handleCommand(input.trim());
      setInput(""); // Clear input after sending
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  const chatContent = (
    <>
      <div className="mb-2 flex-1 overflow-y-auto">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`mb-2 text-sm ${msg.sender === "AI" ? "text-green-400" : "text-blue-400"}`}
          >
            <strong>{msg.sender}:</strong> {msg.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      {messages.length > 0 && (
        <div className="mb-2 flex justify-between items-center">
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Settings
          </button>
          <button
            onClick={() => setMessages([])}
            className="text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-1 rounded"
          >
            Clear
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Settings
          </button>
        </div>
      )}
      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder="Type a command..."
          className="flex-1 p-2 rounded bg-zinc-800 border border-zinc-700 text-white outline-none text-sm focus:border-zinc-500 transition-colors"
        />
      </div>
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        robotName={robotName}
        systemPrompt={configSystemPrompt}
      />
    </>
  );

  // ── Sidebar mode ──
  if (mode === "sidebar") {
    if (!show) return null;
    return (
      <div className="p-3 text-sm text-white flex flex-col h-full">
        {chatContent}
      </div>
    );
  }

  // ── Floating mode (original) ──
  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-50"
      style={{ display: show ? undefined : "none" }}
      cancel="input,select,textarea,button,a,option"
    >
      <div ref={ref} className={"p-4 w-80 z-50 " + panelStyle}>
        <h4 className="border-b border-white/50 pb-2 font-bold mb-2 flex items-center justify-between">
          <span>AI Control Robot</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(true)}
              onTouchEnd={() => setShowSettings(true)}
              className="bg-zinc-700 hover:bg-zinc-600 text-white py-1 px-2 rounded text-sm"
            >
              Settings
            </button>
            <button
              onClick={onHide}
              onTouchEnd={onHide}
              className="text-xl hover:bg-zinc-800 px-2 rounded-full"
              title="Collapse"
            >
              ×
            </button>
          </div>
        </h4>
        <div className="mb-2 max-h-[60vh] overflow-y-auto">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-2 ${msg.sender === "AI" ? "text-green-400" : "text-blue-400"}`}
            >
              <strong>{msg.sender}:</strong> {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {messages.length > 0 && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setMessages([])}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-1 rounded"
            >
              Clear
            </button>
          </div>
        )}
        <div className="flex items-center space-x-2">
          <div className="relative flex items-center w-full">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              placeholder="Type a command..."
              className="flex-1 p-2 rounded bg-zinc-700 text-white outline-none text-sm"
            />
          </div>
        </div>
      </div>
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        robotName={robotName}
        systemPrompt={configSystemPrompt}
      />
    </Rnd>
  );
}
