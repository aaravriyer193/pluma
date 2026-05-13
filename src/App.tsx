import { useEffect, useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import CommandBar from "./components/CommandBar";
import WhisperWindow, { WhisperMessage, loadSession, saveSession, scheduleMidnightReset } from "./components/WhisperWindow";
import Settings from "./components/Settings";
import TaskWidget from "./components/TaskWidget";
import CursorIndicator from "./components/CursorIndicator";
import { parseCommand, buildMessages, GHOST_CHAT } from "./lib/commands";
import { streamCompletion, DEFAULT_MODEL, ChatMessage } from "./lib/openrouter";
import { runAgent, isAgentQuery, AgentStep } from "./lib/agent";

type View = "command" | "settings";

const H_BAR = 62;
const H_WHISPER = 450;
const H_SETTINGS = 300;

export default function App() {
  const label = getCurrentWebviewWindow().label;
  if (label === "cursor") return <CursorIndicator />;
  if (label === "widget") return <TaskWidget />;
  return <MainApp />;
}

function MainApp() {
  const [view, setView] = useState<View>("command");
  const [input, setInput] = useState("");
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [clipboard, setClipboard] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhisperMessage[]>(() => loadSession());
  const [loading, setLoading] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // ── Window sizing ─────────────────────────────────────────────────────────
  useEffect(() => {
    const h = view === "settings" ? H_SETTINGS : whisperOpen ? H_WHISPER : H_BAR;
    invoke("resize_window", { height: h }).catch(() => {});
  }, [view, whisperOpen]);

  // ── Escape: hide window but don't kill agent ──────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!agentRunning) abort.current?.abort();
        invoke("hide_window").catch(() => {});
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentRunning]);

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

  // ── Store turn in RAG after each assistant message ────────────────────────
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.content && !last.streaming) {
      const prev = messages[messages.length - 2];
      const entry = prev?.role === "user"
        ? `User: ${prev.content}\nPluma: ${last.content}`
        : `Pluma: ${last.content}`;
      invoke("rag_insert", { content: entry, source: "conversation" }).catch(() => {});
    }
  }, [messages]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function apiKey(): Promise<string | null> {
    return invoke<string>("get_api_key").catch(() => null);
  }

  function withVision(msgs: ChatMessage[]): ChatMessage[] {
    if (!screenshot) return msgs;
    return [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
          { type: "text", text: "Screenshot of my screen for context." },
        ],
      },
      ...msgs,
    ];
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
    const freshShot = await invoke<string>("take_screenshot").catch(() => null);
    setClipboard(freshClipboard);
    setScreenshot(freshShot);

    // Agent mode for complex tasks
    if (!parsed.command && isAgentQuery(parsed.raw)) {
      await runAgentTask(parsed.raw, freshClipboard, freshShot, key);
      return;
    }

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

  // ── Agent task ────────────────────────────────────────────────────────────
  async function runAgentTask(userMsg: string, clip: string, shot: string | null, key: string) {
    const userWMsg: WhisperMessage = { id: crypto.randomUUID(), role: "user", content: userMsg };
    const streamId = crypto.randomUUID();
    const streamMsg: WhisperMessage = { id: streamId, role: "assistant", content: "", streaming: true };
    setMessages((p) => [...p, userWMsg, streamMsg]);
    setWhisperOpen(true);
    setInput("");
    setLoading(true);
    setAgentRunning(true);
    abort.current = new AbortController();

    invoke("show_widget", { task: userMsg.slice(0, 60) }).catch(() => {});

    const onStep = (step: AgentStep) => {
      if (step.type === "tool_call") {
        const argStr = Object.entries(step.args ?? {}).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join(", ");
        setMessages((p) => [...p, {
          id: step.id + "_call",
          role: "tool_call",
          content: argStr,
          toolName: step.name,
        }]);
      } else if (step.type === "tool_result") {
        setMessages((p) => p.map(m => m.id === step.id + "_call"
          ? m
          : m
        ));
        setMessages((p) => [...p, {
          id: step.id + "_result",
          role: "tool_result",
          content: step.result?.slice(0, 200) ?? "",
          toolName: step.name,
        }]);
      }
    };

    try {
      await runAgent(
        userMsg,
        { clipboard: clip, screenshot: shot },
        key,
        onStep,
        (delta) => setMessages((p) => p.map(m => m.id === streamId ? { ...m, content: m.content + delta } : m)),
        abort.current.signal,
      );
      setMessages((p) => p.map(m => m.id === streamId ? { ...m, streaming: false } : m));
      invoke("show_widget", { task: "Done" }).catch(() => {});
      setTimeout(() => invoke("hide_widget").catch(() => {}), 2000);
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        setMessages((p) => p.map(m => m.id === streamId
          ? { ...m, content: `Error: ${String(e)}`, streaming: false } : m));
      }
      invoke("hide_widget").catch(() => {});
    } finally {
      setLoading(false);
      setAgentRunning(false);
    }
  }

  // ── Whisper send ──────────────────────────────────────────────────────────
  const handleWhisperSend = useCallback(async (text: string) => {
    const key = await apiKey();
    if (!key) { setView("settings"); return; }

    // Agent mode in whisper too
    if (isAgentQuery(text)) {
      const freshClip = await invoke<string>("read_clipboard").catch(() => clipboard);
      const freshShot = await invoke<string>("take_screenshot").catch(() => null);
      await runAgentTask(text, freshClip, freshShot, key);
      return;
    }

    const userMsg: WhisperMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const streamId = crypto.randomUUID();
    const streamMsg: WhisperMessage = { id: streamId, role: "assistant", content: "", streaming: true };
    setMessages((p) => [...p, userMsg, streamMsg]);
    setLoading(true);
    abort.current = new AbortController();

    const history: ChatMessage[] = [
      { role: "system", content: GHOST_CHAT },
      ...[...messages, userMsg].map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
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
      {agentRunning && !whisperOpen && (
        <div className="agent-indicator">
          <div className="spinner"><span /></div>
          Agent running
        </div>
      )}
    </div>
  );
}
