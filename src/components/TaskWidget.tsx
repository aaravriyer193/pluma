import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export default function TaskWidget() {
  const [task, setTask] = useState("Working…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const u1 = listen<string>("widget-task", (e) => { setTask(e.payload); setDone(false); });
    const u2 = listen("widget-done", () => setDone(true));
    return () => { u1.then(f => f()); u2.then(f => f()); };
  }, []);

  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", alignItems: "center",
      background: "rgba(14,14,16,0.92)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 12,
      backdropFilter: "blur(30px)",
      padding: "0 16px",
      gap: 10,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: "rgba(255,255,255,0.85)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      {done ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <div style={{
          width: 12, height: 12, borderRadius: "50%",
          border: "1.5px solid rgba(255,255,255,0.12)",
          borderTopColor: "rgba(255,255,255,0.6)",
          animation: "spin 0.7s linear infinite", flexShrink: 0,
        }} />
      )}
      <span style={{ fontSize: 13, letterSpacing: "-0.01em", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {done ? "Done" : task}
      </span>
      <button
        onClick={() => invoke("hide_widget").catch(() => {})}
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: "2px 4px", fontSize: 16, lineHeight: 1 }}
      >×</button>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
