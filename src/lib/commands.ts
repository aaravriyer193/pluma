export interface ParsedCommand {
  command: string | null;
  arg: string;
  raw: string;
}

export function parseCommand(input: string): ParsedCommand {
  const match = input.match(/^\/(\w+)(?:\s+(.*))?$/s);
  if (!match) return { command: null, arg: input.trim(), raw: input };
  return {
    command: match[1].toLowerCase(),
    arg: (match[2] ?? "").trim(),
    raw: input,
  };
}

export const KNOWN_COMMANDS = [
  "polite", "concise", "regex", "bash", "tldr",
  "explain", "translate", "doc",
] as const;

export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

const GHOST = `You are Pluma, a concise AI ghost editor. Keep responses short — a few lines max unless detail is essential.
Start with [COPY] if output replaces clipboard (rewrites, code, transformations) or [CHAT] for conversational replies. Nothing else before the prefix.
Never truncate output mid-sentence. If a response is long, still complete it fully.`;

export const GHOST_CHAT = `You are Pluma, a concise AI assistant. Keep responses brief. Use markdown when helpful. Never truncate mid-sentence.`;

export const AGENT_SYSTEM = `You are Pluma, an autonomous AI agent running on the user's Windows machine.
You have tools: run_terminal (PowerShell), read_file, write_file, list_directory, mouse_click, type_text, key_press, take_screenshot, recall (search memory).
Think step by step. Use tools to accomplish tasks. Be concise in explanations.
When using run_terminal, prefer PowerShell syntax. Never use destructive commands without asking.
After completing a task, summarize what you did briefly.`;

export function buildMessages(
  parsed: ParsedCommand,
  clipboard: string
): { role: "system" | "user"; content: string }[] {
  const ctx = clipboard.trim();

  switch (parsed.command) {
    case "polite":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Rewrite the following text to be professional and polite. Output only the rewritten text.\n\n${ctx}` },
      ];
    case "concise":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Remove fluff. Shorten this text significantly while preserving its core meaning. Output only the shortened text.\n\n${ctx}` },
      ];
    case "regex":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Translate this plain English description into a single regex pattern. Output only the raw regex, nothing else.\n\n${parsed.arg || ctx}` },
      ];
    case "bash":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Translate this into a PowerShell/shell command. Output only the command, no explanation.\n\n${parsed.arg || ctx}` },
      ];
    case "tldr":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Summarise the following in exactly 3 bullet points. Start each with "• ".\n\n${ctx}` },
      ];
    case "explain":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Explain the following text or code in simple, clear terms. Assume the reader is smart but unfamiliar with the jargon.\n\n${ctx}` },
      ];
    case "translate": {
      const lang = parsed.arg || "English";
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Translate the following text into ${lang}. Output only the translated text.\n\n${ctx}` },
      ];
    }
    case "doc":
      return [
        { role: "system", content: GHOST },
        { role: "user", content: `Generate comprehensive documentation comments / docstrings for the following code. Match the language's documentation convention.\n\n${ctx}` },
      ];
    default: {
      const userMsg = ctx
        ? `Context (clipboard):\n${ctx}\n\n---\n${parsed.raw}`
        : parsed.raw;
      return [
        { role: "system", content: GHOST },
        { role: "user", content: userMsg },
      ];
    }
  }
}
