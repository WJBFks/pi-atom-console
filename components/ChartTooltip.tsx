"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export function ChartTooltip({ text, style }: { text: string; style: CSSProperties }) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const tip = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - tip.width / 2, window.innerWidth - tip.width - 8)),
      top: Math.max(8, rect.top >= tip.height + 16 ? rect.top - tip.height - 8 : Math.min(rect.bottom + 8, window.innerHeight - tip.height - 8)),
    });
  }, [open, text]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const show = () => { setPosition(null); setOpen(true); };
  return <>
    <div ref={anchor} tabIndex={0} aria-label={text} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={() => setOpen(false)}
      onFocus={show} onBlur={() => setOpen(false)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
      style={{ ...style, cursor: "default", filter: open ? "brightness(1.12)" : undefined }} />
    {open && createPortal(<div ref={panel} id={id} role="tooltip" style={{
      position: "fixed", left: position?.left ?? 0, top: position?.top ?? 0,
      visibility: position ? "visible" : "hidden", pointerEvents: "none", zIndex: 1500,
      maxWidth: "min(300px, calc(100vw - 16px))", boxSizing: "border-box",
      padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9,
      background: "var(--bg)", color: "var(--text)", boxShadow: "0 4px 18px rgba(0,0,0,.12)",
      fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
    }}>{text}</div>, document.body)}
  </>;
}
