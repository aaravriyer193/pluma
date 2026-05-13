export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ToolCallResponse {
  tool_calls: ToolCall[];
  content: string | null;
}

export const DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";

// Non-streaming call that returns tool_calls if present
export async function callWithTools(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal
): Promise<ToolCallResponse> {
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pluma.app",
      "X-Title": "Pluma",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  const content: string | null = msg?.content ?? null;
  const tool_calls: ToolCall[] = msg?.tool_calls ?? [];

  // Fallback: parse <tool_call> tags from content if no native tool_calls
  if (tool_calls.length === 0 && content) {
    const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        tool_calls.push({
          id: `tc_${Math.random().toString(36).slice(2)}`,
          type: "function",
          function: { name: parsed.name, arguments: JSON.stringify(parsed.args ?? parsed.arguments ?? {}) },
        });
      } catch { /* skip malformed */ }
    }
  }

  return { tool_calls, content };
}

export async function streamCompletion(opts: CompletionOptions): Promise<string> {
  const { apiKey, model, messages, onChunk, signal } = opts;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pluma.app",
      "X-Title": "Pluma",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return full;
      try {
        const json = JSON.parse(data);
        const delta: string = json.choices?.[0]?.delta?.content ?? "";
        if (delta) { full += delta; onChunk?.(delta); }
      } catch { /* skip malformed SSE */ }
    }
  }
  return full;
}
