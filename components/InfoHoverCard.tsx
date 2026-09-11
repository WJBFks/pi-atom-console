"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function InfoCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <button type="button" className="pi-info-copy" aria-label={copied ? "已复制" : "复制"} onClick={async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value); setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{copied ? <path d="m5 12 4 4L19 6"/> : <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>}</svg>
    <span className="pi-info-copy-tip" role="status">{copied ? "已复制" : "复制"}</span>
  </button>;
}

export function InfoHoverCard({ children, fields, sessionId }: { children: ReactNode; fields: [string, string][]; sessionId?: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [activeDuration, setActiveDuration] = useState("加载中…");
  useEffect(() => {
    if (!open || !sessionId) return;
    const controller = new AbortController();
    setActiveDuration("加载中…");
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}?tail=1&deferThinking=1&deferMedia=1`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => {
        if (typeof data.totalActiveMs !== "number") { setActiveDuration("暂无记录"); return; }
        const seconds = Math.max(0, Math.floor(data.totalActiveMs / 1000));
        setActiveDuration(`${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}小时 ` : ""}${Math.floor(seconds % 3600 / 60)}分 ${seconds % 60}秒`);
      }).catch(() => { if (!controller.signal.aborted) setActiveDuration("暂无记录"); });
    return () => controller.abort();
  }, [open, sessionId]);

  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  const leave = () => { cancel(); timer.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => cancel(), []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect(), p = panel.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(a.right + 8, window.innerWidth - p.width - 8)), top: Math.max(8, Math.min(a.top, window.innerHeight - p.height - 8)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const scroll = (e: Event) => { if (!(e.target instanceof Node) || !panel.current?.contains(e.target)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("resize", close); document.addEventListener("scroll", scroll, true); document.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", close); document.removeEventListener("scroll", scroll, true); document.removeEventListener("keydown", key); };
  }, [open]);
  return <><div ref={anchor} onMouseEnter={() => { cancel(); setOpen(true); }} onMouseLeave={leave} onPointerDown={() => { cancel(); setOpen(false); }}>{children}</div>
    {open && createPortal(<div ref={panel} role="dialog" aria-label="会话信息" onMouseEnter={cancel} onMouseLeave={leave} style={{ position: "fixed", ...position, zIndex: 1250, width: 360, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", overflow: "auto", boxSizing: "border-box", padding: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", boxShadow: "0 6px 24px rgba(0,0,0,.12)", fontSize: 11, lineHeight: 1.5 }}>
      {(sessionId ? [...fields, ["活跃时长", activeDuration]] : fields).map(([label, value], index) => <div key={label} style={{ marginTop: index ? 12 : 0 }}><div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{label}</div><div style={{ display: "flex", alignItems: "start", gap: 8 }}><span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{value}</span><InfoCopyButton value={value}/></div></div>)}
    </div>, document.body)}
  </>;
}
