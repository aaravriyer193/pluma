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

const GHOST = `You are Pluma, a concise AI ghost editor embedded in the user's OS. Keep responses short — a few lines max unless detail is essential.
Start your response with exactly [COPY] if the output should replace the user's clipboard text (rewrites, transformations, code), or [CHAT] for conversational or explanatory replies. Nothing else before the prefix. Strip the prefix from the actual output.`;

export const GHOST_CHAT = `You are Pluma, a concise AI assistant. Keep responses brief. Use markdown when helpful.`;

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
        { role: "user", content: `Translate this into a shell/terminal command. Output only the command, no explanation.\n\n${parsed.arg || ctx}` },
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
