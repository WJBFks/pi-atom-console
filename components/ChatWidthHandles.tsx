"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { CHAT_CONTENT_WIDTH_MIN, CHAT_CONTENT_WIDTH_MAX, useChatAppearance } from "@/hooks/useChatAppearance";

export function ChatWidthHandles({ content }: { content: RefObject<HTMLDivElement | null> }) {
  const { width, setWidth } = useChatAppearance();
  const overlay = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: 0, right: 0, available: 0 });
  const [hover, setHover] = useState<{ side: string; y: number } | null>(null);
  const drag = useRef<{ x: number; width: number; side: string } | null>(null);
  useEffect(() => {
    const parent = overlay.current?.parentElement;
    const target = content.current;
    if (!parent || !target) return;
    const update = () => {
      const p = overlay.current!.getBoundingClientRect(), c = target.getBoundingClientRect();
      setEdges({ left: c.left - p.left, right: c.right - p.left, available: p.width });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(parent); observer.observe(target);
    return () => observer.disconnect();
  }, [content]);
  useEffect(() => () => { drag.current = null; }, []);
  return <div ref={overlay} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 30 }}>
    {edges.available >= CHAT_CONTENT_WIDTH_MIN && ["left", "right"].map((side) => <div key={side} role="separator" aria-label="调整聊天内容宽度" aria-orientation="vertical" aria-valuemin={CHAT_CONTENT_WIDTH_MIN} aria-valuemax={CHAT_CONTENT_WIDTH_MAX} aria-valuenow={width} tabIndex={0}
      onPointerEnter={(e) => { if (e.pointerType !== "touch") setHover({ side, y: e.clientY - (overlay.current?.getBoundingClientRect().top ?? 0) }); }}
      onPointerLeave={() => { if (!drag.current) setHover(null); }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        drag.current = { x: e.clientX, width: edges.right - edges.left, side };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const y = e.clientY - (overlay.current?.getBoundingClientRect().top ?? 0);
        setHover({ side, y });
        if (drag.current) setWidth(Math.min(edges.available - 32, drag.current.width + (e.clientX - drag.current.x) * (drag.current.side === "left" ? -2 : 2)));
      }}
      onPointerUp={(e) => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setHover(null); }}
      onPointerCancel={() => { drag.current = null; setHover(null); }}
      onLostPointerCapture={() => { drag.current = null; setHover(null); }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWidth(width + (e.key === "ArrowRight" ? 24 : -24) * (side === "left" ? -1 : 1)); } }}
      style={{ position: "absolute", top: 0, bottom: 0, left: (side === "left" ? edges.left : edges.right) - 10, width: 20, pointerEvents: "auto", cursor: "ew-resize", touchAction: "none" }}>
      {hover?.side === side && <div style={{ position: "absolute", left: 8, top: Math.max(0, Math.min((overlay.current?.clientHeight ?? 120) - 120, hover.y - 60)), width: 3, height: 120, opacity: 0.45, borderRadius: 999, background: "linear-gradient(transparent, var(--text-dim), transparent)", pointerEvents: "none" }} />}
    </div>)}
  </div>;
}
