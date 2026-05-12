import { useRef, useEffect, KeyboardEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface WhisperMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Props {
  messages: WhisperMessage[];
  clipboardText: string;
  isLoading: boolean;
  onSend: (text: string) => void;
}

export default function WhisperWindow({ messages, clipboardText, isLoading, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 80) + "px";
  }, [draft]);

  function submit() {
    const t = draft.trim();
    if (!t || isLoading) return;
    onSend(t);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  return (
    <div className="whisper">
      <div className="divider" />

      {clipboardText && (
        <div className="ctx-bar">
          <span className="ctx-label">ctx</span>
          <span className="ctx-value">{clipboardText}</span>
        </div>
      )}

      <div className="messages">
        {messages.length === 0
          ? <div className="msg-empty">Clipboard context loaded — ask anything</div>
          : messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <span className="msg-role">{m.role === "user" ? "you" : "pluma"}</span>
              <div className="msg-body">
                {m.role === "assistant"
                  ? <><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>{m.streaming && <span className="cursor" />}</>
                  : <>{m.content}{m.streaming && <span className="cursor" />}</>
                }
              </div>
            </div>
          ))
        }
        <div ref={endRef} />
      </div>

      <div className="whisper-input-row">
        <textarea ref={taRef} className="whisper-input" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="Ask anything… (Shift+Enter for newline)" rows={1} disabled={isLoading} />
        <button className="send-btn" onClick={submit} disabled={!draft.trim() || isLoading}>
          {isLoading
            ? <div className="spinner" style={{ width: 12, height: 12 }} />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
          }
        </button>
      </div>
    </div>
  );
}

// ── Session persistence ───────────────────────────────────────────────────────
const KEY = "pluma_session";
interface Stored { date: string; messages: WhisperMessage[]; }

export function loadSession(): WhisperMessage[] {
  try {
    const s: Stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!s || s.date !== today()) { localStorage.removeItem(KEY); return []; }
    return s.messages;
  } catch { return []; }
}
export function saveSession(msgs: WhisperMessage[]) {
  localStorage.setItem(KEY, JSON.stringify({ date: today(), messages: msgs }));
}
export function clearSession() { localStorage.removeItem(KEY); }
export function scheduleMidnightReset(cb: () => void) {
  const now = new Date();
  const ms = new Date(now).setHours(24, 0, 0, 0) - now.getTime();
  const id = setTimeout(() => { clearSession(); cb(); }, ms);
  return () => clearTimeout(id);
}
function today() { return new Date().toISOString().slice(0, 10); }
