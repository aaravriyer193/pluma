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

export const DEFAULT_MODEL = "xiaomi/mimo-v2.5";

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

  // Fallback: parse tool calls from content if model doesn't use native format
  if (tool_calls.length === 0 && content) {
    const blockRe = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let block: RegExpExecArray | null;
    while ((block = blockRe.exec(content)) !== null) {
      const inner = block[1].trim();

      // Format A: JSON object  {"name":"...", "args":{...}}
      try {
        const p = JSON.parse(inner);
        if (p.name) {
          tool_calls.push({
            id: `tc_${Math.random().toString(36).slice(2)}`,
            type: "function",
            function: { name: p.name, arguments: JSON.stringify(p.args ?? p.arguments ?? p.parameters ?? {}) },
          });
          continue;
        }
      } catch { /* not JSON */ }

      // Format B: <function=name> <parameter=key>value</parameter> </function>
      const fnMatch = inner.match(/<function=(\w+)>/);
      if (fnMatch) {
        const name = fnMatch[1];
        const args: Record<string, string> = {};
        const paramRe = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
        let pm: RegExpExecArray | null;
        while ((pm = paramRe.exec(inner)) !== null) {
          args[pm[1]] = pm[2].trim();
        }
        tool_calls.push({
          id: `tc_${Math.random().toString(36).slice(2)}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        });
      }
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
