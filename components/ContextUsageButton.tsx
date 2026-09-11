"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export type ContextUsage = { percent: number | null; contextWindow: number; tokens: number | null };

export function ContextUsageButton({ usage, onCompact, onAbort, compacting, streaming }: {
  usage?: ContextUsage | null;
  onCompact: () => void;
  onAbort?: () => void;
  compacting?: boolean;
  streaming?: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const zh = locale.startsWith("zh");
  const percent = usage?.percent;
  const progress = Math.max(0, Math.min(100, percent ?? 0));
  const format = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString(locale);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div ref={root} style={{ position: "relative", flexShrink: 0 }} onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); button.current?.focus(); }
    }}>
      <button ref={button} type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label={zh ? "上下文用量" : "Context usage"}
        title={zh ? "上下文用量" : "Context usage"}
        style={{ display: "grid", placeItems: "center", width: 32, height: 32, padding: 0, border: 0, borderRadius: 16, background: open ? "var(--bg-selected)" : "transparent", cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = open ? "var(--bg-selected)" : "transparent"; }}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle cx="12" cy="12" r="9" fill="none" stroke={progress > 90 ? "#ef4444" : "var(--accent)"} strokeWidth="3" pathLength="100" strokeDasharray={`${progress} 100`} transform="rotate(-90 12 12)" />
        </svg>
      </button>
      {open && <div role="dialog" aria-label={zh ? "上下文信息" : "Context information"} style={{ position: "absolute", bottom: 40, right: 0, width: 270, maxWidth: "calc(100vw - 32px)", padding: 14, boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg)", boxShadow: "0 4px 24px rgba(0,0,0,.1)", zIndex: 500, fontSize: 12, color: "var(--text-muted)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{zh ? "上下文已用" : "Context used"} {percent == null ? "—" : `${percent.toFixed(1)}%`}</span>
        </div>
        <div style={{ height: 4, background: "var(--border)", borderRadius: 4, margin: "12px 0" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span>{zh ? "已用 token" : "Used tokens"}</span><span>{format(usage?.tokens)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><span>{zh ? "上下文容量" : "Context window"}</span><span>{format(usage?.contextWindow)}</span></div>
        <button type="button" disabled={compacting ? !onAbort : streaming || !usage}
          onClick={compacting ? onAbort : onCompact}
          style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-hover)", color: compacting ? "#ef4444" : "var(--text)", cursor: "pointer" }}>
          {compacting ? t("chat.stopCompaction") : t("chat.compactContext")}
        </button>
      </div>}
    </div>
  );
}
