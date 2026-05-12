import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import CommandBar from "./components/CommandBar";
import WhisperWindow, { WhisperMessage, loadSession, saveSession, scheduleMidnightReset } from "./components/WhisperWindow";
import Settings from "./components/Settings";
import { parseCommand, buildMessages, GHOST_CHAT } from "./lib/commands";
import { streamCompletion, DEFAULT_MODEL, ChatMessage } from "./lib/openrouter";

type View = "command" | "settings";

const H_BAR = 62;
const H_WHISPER = 450;
const H_SETTINGS = 300;

export default function App() {
  const [view, setView] = useState<View>("command");
  const [input, setInput] = useState("");
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [clipboard, setClipboard] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhisperMessage[]>(() => loadSession());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // ── Window sizing ─────────────────────────────────────────────────────────
  useEffect(() => {
    const h = view === "settings" ? H_SETTINGS : whisperOpen ? H_WHISPER : H_BAR;
    invoke("resize_window", { height: h }).catch(() => {});
  }, [view, whisperOpen]);

  // ── Escape to hide ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { abort.current?.abort(); invoke("hide_window").catch(() => {}); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── window-shown: reset state, grab clipboard + screenshot ───────────────
  useEffect(() => {
    const u = listen("window-shown", async () => {
      setInput("");
      setView("command");
      setWhisperOpen(false);

      const text = await invoke<string>("read_clipboard").catch(() => "");
      setClipboard(text ?? "");
      const shot = await invoke<string>("take_screenshot").catch(() => null);
      setScreenshot(shot);
    });
    return () => { u.then((fn) => fn()); };
  }, []);

  // ── Midnight reset ────────────────────────────────────────────────────────
  useEffect(() => {
    const cancel = scheduleMidnightReset(() => { setMessages([]); flash("Session cleared"); });
    return cancel;
  }, []);

  useEffect(() => { saveSession(messages); }, [messages]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2000); }

  async function apiKey(): Promise<string | null> {
    return invoke<string>("get_api_key").catch(() => null);
  }

  function withVision(msgs: ChatMessage[]): ChatMessage[] {
    if (!screenshot) return msgs;
    const imgMsg: ChatMessage = {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
        { type: "text", text: "Screenshot of my screen for context." },
      ],
    };
    return [imgMsg, ...msgs];
  }

  function parsePrefix(result: string): { copy: boolean; content: string } {
    const up = result.trimStart();
    if (up.startsWith("[COPY]")) return { copy: true, content: up.slice(6).trimStart() };
    if (up.startsWith("[CHAT]")) return { copy: false, content: up.slice(6).trimStart() };
    return { copy: false, content: result };
  }

  // ── Command submit ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const parsed = parseCommand(input.trim());
    if (!parsed.raw) return;
    const key = await apiKey();
    if (!key) { setView("settings"); return; }

    const freshClipboard = await invoke<string>("read_clipboard").catch(() => clipboard);
    const msgs = withVision(buildMessages(parsed, freshClipboard) as ChatMessage[]);

    setLoading(true);
    abort.current = new AbortController();
    try {
      const raw = await streamCompletion({ apiKey: key, model: DEFAULT_MODEL, messages: msgs, signal: abort.current.signal });
      const { copy, content } = parsePrefix(raw);
      if (copy) {
        await invoke("paste_result", { text: content });
        flash("Pasted ✓");
      } else {
        const u: WhisperMessage = { id: crypto.randomUUID(), role: "user", content: parsed.raw };
        const a: WhisperMessage = { id: crypto.randomUUID(), role: "assistant", content };
        setMessages((p) => [...p, u, a]);
        setWhisperOpen(true);
        setInput("");
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") flash(`Error: ${String(e)}`);
    } finally { setLoading(false); }
  }, [input, clipboard, screenshot]);

  // ── Whisper send ──────────────────────────────────────────────────────────
  const handleWhisperSend = useCallback(async (text: string) => {
    const key = await apiKey();
    if (!key) { setView("settings"); return; }

    const userMsg: WhisperMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const streamId = crypto.randomUUID();
    const streamMsg: WhisperMessage = { id: streamId, role: "assistant", content: "", streaming: true };
    setMessages((p) => [...p, userMsg, streamMsg]);
    setLoading(true);
    abort.current = new AbortController();

    const history: ChatMessage[] = [
      { role: "system", content: GHOST_CHAT },
      ...([...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))),
    ];
    if (clipboard) history.splice(1, 0, { role: "user", content: `[Clipboard context]\n${clipboard}` });
    const msgsWithVision = withVision(history);

    try {
      await streamCompletion({
        apiKey: key, model: DEFAULT_MODEL, messages: msgsWithVision, signal: abort.current.signal,
        onChunk: (d) => setMessages((p) => p.map((m) => m.id === streamId ? { ...m, content: m.content + d } : m)),
      });
      setMessages((p) => p.map((m) => m.id === streamId ? { ...m, streaming: false } : m));
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        setMessages((p) => p.map((m) => m.id === streamId ? { ...m, content: `Error: ${String(e)}`, streaming: false } : m));
      }
    } finally { setLoading(false); }
  }, [messages, clipboard, screenshot]);

  const h = view === "settings" ? H_SETTINGS : whisperOpen ? H_WHISPER : H_BAR;

  return (
    <div className="pluma-shell" data-tauri-drag-region>
      <div className="pluma-card" style={{ height: h }}>
        {view === "settings" ? (
          <Settings onClose={() => setView("command")} />
        ) : (
          <>
            <CommandBar value={input} onChange={setInput} onSubmit={handleSubmit}
              onTabExpand={() => setWhisperOpen((p) => !p)} onOpenSettings={() => setView("settings")}
              isLoading={loading} isWhisperOpen={whisperOpen} />
            {whisperOpen && <WhisperWindow messages={messages} clipboardText={clipboard} isLoading={loading} onSend={handleWhisperSend} />}
          </>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
