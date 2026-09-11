"use client";
import { useEffect, useRef, useState } from "react";
import { useTemporaryWorkspace } from "@/hooks/useTemporaryWorkspace";
import type { SessionInfo } from "@/lib/types";
export function NewWorkspaceSelector({ cwd, sessions, onSelect, onOpenTemporarySettings }: { onOpenTemporarySettings: () => void; cwd: string | null; sessions: SessionInfo[]; onSelect: (cwd: string) => void }) {
  const { path, home, ready } = useTemporaryWorkspace();
  const normalizePath = (value: string) => {
    let normalized = value.replace(/\\/g, "/").replace(/^~(?=\/|$)/, home.replace(/\\/g, "/") || "~").replace(/\/+$/, "");
    if (/^[a-z]:/i.test(normalized) || normalized.startsWith("//")) normalized = normalized.toLowerCase();
    return normalized;
  };
  const isTemporary = Boolean(cwd) && normalizePath(cwd!) === normalizePath(path);

  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { try { setNames(JSON.parse(localStorage.getItem("pi-web:workspace-names") || "{}")); } catch {} }, [open]);
  useEffect(() => { const close = (e: PointerEvent) => { if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, []);
  const name = (root: string) => names[root] || root.split(/[\\/]/).filter(Boolean).at(-1) || root;
  const currentRoot = sessions.find((s) => s.cwd === cwd)?.projectRoot ?? cwd;
  const activity = new Map<string, number>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    const time = Date.parse(session.modified);
    activity.set(root, Math.max(activity.get(root) ?? 0, Number.isFinite(time) ? time : 0));
  }
  if (currentRoot && !activity.has(currentRoot)) activity.set(currentRoot, 0);
  const workspaces = [...activity.keys()].sort((a, b) => (activity.get(b)! - activity.get(a)!) || a.localeCompare(b));
  const choose = async (root: string, temporary = false) => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/cwd/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: root, createIfMissing: temporary }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "无法切换工作区");
      onSelect(data.cwd); setOpen(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <div ref={ref} style={{ position: "relative", fontSize: 12 }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ border: 0, borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", padding: "6px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{isTemporary ? <path d="M12 3a9 9 0 1 0 9 9M12 7v5l-3 2M19 2v6m-3-3h6"/> : <><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></>}</svg> {isTemporary ? "临时工作区" : !ready ? "加载中…" : currentRoot ? name(currentRoot) : "选择工作区"} ▾</button>
    {open && <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 400, maxWidth: "calc(100vw - 48px)", maxHeight: 260, display: "flex", flexDirection: "column", overflow: "hidden", padding: 6, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", boxShadow: "0 6px 24px rgba(0,0,0,.12)", zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", paddingBottom: 4, gap: 4 }}>
        <button className="pi-workspace-menu-item" style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "#377fba", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }} onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }} type="button" disabled={busy} onClick={() => void choose(path, true)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9M12 7v5l-3 2M19 2v6m-3-3h6"/></svg>临时工作区</button>
        <button className="pi-info-copy" type="button" aria-label="设置临时工作区路径" onClick={() => { setOpen(false); onOpenTemporarySettings(); }} style={{ width: 28, height: 28, flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg)"/><circle cx="15" cy="17" r="3" fill="var(--bg)"/></svg>
          <span className="pi-info-copy-tip">设置临时工作区路径</span>
        </button>
      </div>
      <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", flex: "1 1 auto" }}>
      {workspaces.map((root) => <button className="pi-workspace-menu-item" type="button" disabled={busy} key={root} onClick={() => void choose(root)}>{name(root)}<span style={{ display: "block", color: "var(--text-dim)", fontSize: 10, overflowWrap: "anywhere" }}>{root}</span></button>)}
      </div>
      {error && <div role="alert" style={{ color: "#dc2626", padding: 8 }}>{error}</div>}
    </div>}
  </div>;
}
