import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface Pt { x: number; y: number; }

export default function CursorIndicator() {
  const [pos, setPos] = useState<Pt | null>(null);
  const [ripples, setRipples] = useState<(Pt & { id: string })[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u = listen<Pt>("click-at", (e) => {
      const { x, y } = e.payload;
      setPos({ x, y });
      const id = crypto.randomUUID();
      setRipples(r => [...r, { id, x, y }]);
      setTimeout(() => setRipples(r => r.filter(p => p.id !== id)), 700);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setPos(null), 2200);
    });
    return () => { u.then(f => f()); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "transparent", pointerEvents: "none", overflow: "hidden" }}>

      {/* Targeting reticle + label */}
      {pos && (
        <div key={`${pos.x}-${pos.y}`} style={{
          position: "absolute",
          left: pos.x - 28,
          top: pos.y - 28,
          width: 56,
          height: 56,
          pointerEvents: "none",
          animation: "reticle-in 0.18s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
          <svg width="56" height="56" viewBox="0 0 56 56" style={{ display: "block", filter: "drop-shadow(0 0 6px rgba(120,220,255,0.7))" }}>
            {/* Corner brackets */}
            <path d="M10 4 L4 4 L4 10"   fill="none" stroke="rgba(120,220,255,0.95)" strokeWidth="2" strokeLinecap="round"/>
            <path d="M46 4 L52 4 L52 10"  fill="none" stroke="rgba(120,220,255,0.95)" strokeWidth="2" strokeLinecap="round"/>
            <path d="M4 46 L4 52 L10 52"  fill="none" stroke="rgba(120,220,255,0.95)" strokeWidth="2" strokeLinecap="round"/>
            <path d="M52 46 L52 52 L46 52" fill="none" stroke="rgba(120,220,255,0.95)" strokeWidth="2" strokeLinecap="round"/>
            {/* Center crosshair */}
            <circle cx="28" cy="28" r="2.5" fill="rgba(120,220,255,0.95)"/>
            <line x1="22" y1="28" x2="18" y2="28" stroke="rgba(120,220,255,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="34" y1="28" x2="38" y2="28" stroke="rgba(120,220,255,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="28" y1="22" x2="28" y2="18" stroke="rgba(120,220,255,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="28" y1="34" x2="28" y2="38" stroke="rgba(120,220,255,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
            {/* Scan line */}
            <line x1="4" y1="28" x2="52" y2="28" stroke="rgba(120,220,255,0.08)" strokeWidth="1" style={{ animation: "scan-line 1.8s linear infinite" }}/>
          </svg>

          {/* PLUMA label */}
          <div style={{
            position: "absolute",
            top: 54,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,8,16,0.82)",
            border: "1px solid rgba(120,220,255,0.25)",
            borderRadius: 4,
            padding: "2px 7px",
            fontSize: 9,
            fontFamily: "'Cascadia Code','Fira Code',monospace",
            fontWeight: 600,
            color: "rgba(120,220,255,0.9)",
            letterSpacing: "0.18em",
            whiteSpace: "nowrap",
            backdropFilter: "blur(4px)",
          }}>PLUMA</div>
        </div>
      )}

      {/* Click ripples */}
      {ripples.map(rp => (
        <div key={rp.id} style={{
          position: "absolute",
          left: rp.x - 22,
          top: rp.y - 22,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1.5px solid rgba(120,220,255,0.75)",
          background: "rgba(120,220,255,0.04)",
          boxShadow: "0 0 10px rgba(120,220,255,0.2)",
          animation: "click-ripple 0.65s cubic-bezier(0.15,0,0.6,1) forwards",
          pointerEvents: "none",
        }} />
      ))}

      <style>{`
        @keyframes reticle-in {
          from { transform: scale(1.4); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @keyframes click-ripple {
          0%   { transform: scale(0.2); opacity: 1; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes scan-line {
          0%   { transform: translateY(-24px); opacity: 0.4; }
          50%  { opacity: 0.12; }
          100% { transform: translateY(24px);  opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
