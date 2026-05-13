import { invoke } from "@tauri-apps/api/core";
import { callWithTools, streamCompletion, ChatMessage, ToolDefinition, DEFAULT_MODEL } from "./openrouter";
import { AGENT_SYSTEM } from "./commands";

export interface AgentStep {
  id: string;
  type: "tool_call" | "tool_result" | "thinking";
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  content?: string;
}

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "run_terminal",
      description: "Run a PowerShell command on the user's Windows machine. Returns stdout, stderr, exit_code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "PowerShell command to execute" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the text contents of a file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to file" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write text content to a file (creates if not exists, overwrites if exists).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and folders in a directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_click",
      description: "Click at absolute screen coordinates.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle"], description: "Defaults to left" },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text using the keyboard at the current cursor position.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "key_press",
      description: "Press a keyboard key. Supported: enter, escape, tab, backspace, delete, up, down, left, right, home, end, pageup, pagedown, or a single character.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "take_screenshot",
      description: "Capture the current screen and return it as a base64 PNG for inspection.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Search Pluma's local memory for past context about the user, previous tasks, or any stored information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
        },
        required: ["query"],
      },
    },
  },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "run_terminal": {
        const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
          "execute_terminal", { command: args.command as string }
        );
        return `exit_code: ${r.exit_code}\nstdout: ${r.stdout || "(empty)"}${r.stderr ? `\nstderr: ${r.stderr}` : ""}`;
      }
      case "read_file":
        return await invoke<string>("read_file_content", { path: args.path as string });
      case "write_file":
        await invoke("write_file_content", { path: args.path as string, content: args.content as string });
        return "File written successfully.";
      case "list_directory": {
        const entries = await invoke<{ name: string; path: string; is_dir: boolean; size: number }[]>(
          "list_directory", { path: args.path as string }
        );
        return entries.map(e => `${e.is_dir ? "[dir]" : "[file]"} ${e.name}${e.is_dir ? "" : ` (${e.size}b)`}`).join("\n");
      }
      case "mouse_click":
        await invoke("mouse_click", { x: args.x, y: args.y, button: args.button ?? "left" });
        return "Clicked.";
      case "type_text":
        await invoke("type_text", { text: args.text as string });
        return "Typed.";
      case "key_press":
        await invoke("key_press", { key: args.key as string });
        return "Key pressed.";
      case "take_screenshot": {
        const b64 = await invoke<string>("take_screenshot");
        return `screenshot:base64:${b64}`;
      }
      case "recall": {
        const results = await invoke<{ content: string; source: string }[]>(
          "rag_query", { query: args.query as string, limit: 5 }
        );
        if (!results.length) return "No relevant memories found.";
        return results.map(r => `[${r.source}] ${r.content}`).join("\n\n");
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export async function runAgent(
  userMessage: string,
  context: { clipboard: string; screenshot?: string | null },
  apiKey: string,
  onStep: (step: AgentStep) => void,
  onFinalChunk: (delta: string) => void,
  signal: AbortSignal
): Promise<string> {
  const messages: ChatMessage[] = [{ role: "system", content: AGENT_SYSTEM }];

  if (context.clipboard) {
    messages.push({ role: "user", content: `[Clipboard context]\n${context.clipboard}` });
  }
  if (context.screenshot) {
    messages.push({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${context.screenshot}` } },
        { type: "text", text: "Current screen for context." },
      ],
    });
  }
  messages.push({ role: "user", content: userMessage });

  let iterations = 0;
  const MAX_ITERATIONS = 12;

  while (iterations++ < MAX_ITERATIONS) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const { tool_calls, content } = await callWithTools(apiKey, DEFAULT_MODEL, messages, TOOLS, signal);

    if (!tool_calls.length) {
      // Final response — stream it
      const finalMsgs: ChatMessage[] = [...messages, { role: "assistant", content: content ?? "" }];
      // Stream the final answer from scratch for smooth UX
      const streamed = await streamCompletion({
        apiKey,
        model: DEFAULT_MODEL,
        messages: finalMsgs.slice(0, -1), // send without the last assistant msg
        onChunk: onFinalChunk,
        signal,
      });
      return streamed || content || "";
    }

    // Push assistant message with tool_calls
    messages.push({ role: "assistant", content: content ?? null, tool_calls });

    for (const tc of tool_calls) {
      const args = (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })();
      const stepId = crypto.randomUUID();

      onStep({ id: stepId, type: "tool_call", name: tc.function.name, args });

      let result = await executeTool(tc.function.name, args);

      // If screenshot result, don't flood the message — send as vision
      if (result.startsWith("screenshot:base64:")) {
        const b64 = result.slice("screenshot:base64:".length);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Screenshot taken.",
        });
        // Add vision context
        messages.push({
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            { type: "text", text: "This is the screenshot you just took." },
          ],
        });
        result = "Screenshot captured and shown above.";
      } else {
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      onStep({ id: stepId, type: "tool_result", name: tc.function.name, result: result.slice(0, 400) });
    }
  }

  return "Agent reached maximum steps.";
}

// Detect if a query should run in agent mode
export function isAgentQuery(input: string): boolean {
  const agentKeywords = [
    "open ", "click ", "type ", "search ", "find file", "create file", "write to",
    "run ", "execute", "install ", "download ", "go to ", "browse", "navigate",
    "move ", "copy ", "delete ", "rename ", "list files", "show me", "check if",
    "read file", "what files", "in my ", "on my ", "my desktop", "my documents",
    "schedule", "remind", "automate", "do it", "make it", "fix it",
  ];
  const lo = input.toLowerCase();
  return agentKeywords.some(k => lo.includes(k));
}
