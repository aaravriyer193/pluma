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
      gap: 12,
      background: "rgba(10,10,12,0.92)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 14,
      backdropFilter: "blur(40px) saturate(180%)",
      padding: "0 14px",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.05) inset",
      animation: done ? "notif-done 0.35s cubic-bezier(0.34,1.56,0.64,1)" : "notif-in 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      overflow: "hidden",
    }}>

      {/* App icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="18" height="18" viewBox="0 0 512 512" fill="rgba(255,255,255,0.75)">
          <path d="M467.14 44.84c-62.55-62.48-161.67-64.78-252.28 25.73-78.61 78.52-60.98 60.92-85.75 85.66-60.46 60.39-70.39 150.83-63.64 211.17l178.44-178.25c6.26-6.25 16.4-6.25 22.65 0s6.25 16.38 0 22.63L7.04 471.03c-9.38 9.37-9.38 24.57 0 33.94 9.38 9.37 24.6 9.37 33.98 0l66.1-66.03C159.42 454.65 279 457.11 353.95 384h-98.19l147.57-49.14c49.99-49.93 36.38-36.18 46.31-46.86h-97.78l131.54-43.8c45.44-74.46 34.31-148.84-16.26-199.36z"/>
        </svg>
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", marginBottom: 2 }}>
          {done ? "PLUMA · DONE" : "PLUMA · AGENT"}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: done ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.7)",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          letterSpacing: "-0.01em",
        }}>
          {done ? "Task complete" : task}
        </div>
      </div>

      {/* Status indicator */}
      {done ? (
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "check-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.1s both",
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          {[0, 0.2, 0.4].map((delay, i) => (
            <div key={i} style={{
              width: 4, height: 4, borderRadius: "50%",
              background: "rgba(255,255,255,0.55)",
              animation: `dot-pulse 1.2s ease-in-out ${delay}s infinite`,
            }} />
          ))}
        </div>
      )}

      {/* Dismiss */}
      <button onClick={() => invoke("hide_widget").catch(() => {})} style={{
        background: "none", border: "none",
        color: "rgba(255,255,255,0.2)", cursor: "pointer",
        padding: "4px", fontSize: 16, lineHeight: 1, flexShrink: 0,
        transition: "color 0.1s",
      }}
        onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
      >×</button>

      <style>{`
        @keyframes notif-in {
          from { transform: translateY(8px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0)   scale(1);    opacity: 1; }
        }
        @keyframes notif-done {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        @keyframes check-pop {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes dot-pulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40%            { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}
