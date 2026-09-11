"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { InfoCopyButton } from "./InfoHoverCard";

export function SessionFooterStats({ stats }: { stats: SessionStatsInfo | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => setOpen(null), [stats?.sessionId]);
  const t = stats?.tokens;
  const short = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
  const speed = stats?.totalActiveMs && stats.totalActiveMs > 0 ? `${(stats.tokens.output * 1000 / stats.totalActiveMs).toFixed(1)}` : "—";
  const denominator = t ? t.input + t.cacheRead + t.cacheWrite : 0;
  const hit = denominator ? `${(100 * (t?.cacheRead ?? 0) / denominator).toFixed(1)}%` : "—";
  const duration = stats?.totalActiveMs == null ? "—" : `${Math.floor(stats.totalActiveMs / 60000)}分 ${Math.floor(stats.totalActiveMs / 1000) % 60}秒`;
  const metric = (kind: "in" | "out" | "total" | "cache", value: string) => {
    const labels = { in: "输入", out: "输出", total: "总 Token", cache: "缓存命中率" };
    return <span aria-label={`${labels[kind]} ${value}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === "in" ? <path d="M12 20V4m-6 6 6-6 6 6"/> : kind === "out" ? <path d="M12 4v16m-6-6 6 6 6-6"/> : kind === "total" ? <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></> : <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></>}
      </svg>{value}
    </span>;
  };
  const groups: { label: ReactNode; title: string; fields: [string, string][] }[] = [
    { label: `${stats?.userMessages ?? 0}轮${stats?.traceSteps ?? 0}步 · ${speed} tok/s`, title: "对话与轨迹", fields: [["对话轮数", String(stats?.userMessages ?? 0)], ["轨迹事件数", String(stats?.traceSteps ?? 0)], ["平均输出速度（估算）", `${speed} tok/s`], ["活跃时长", duration]] },
    { label: <>{metric("in", short(t?.input ?? 0))}{metric("out", short(t?.output ?? 0))}{metric("total", short(t?.total ?? 0))}</>, title: "Token 用量", fields: [["输入", (t?.input ?? 0).toLocaleString()], ["输出", (t?.output ?? 0).toLocaleString()], ["缓存读取", (t?.cacheRead ?? 0).toLocaleString()], ["缓存写入", (t?.cacheWrite ?? 0).toLocaleString()], ["总计", (t?.total ?? 0).toLocaleString()]] },
    { label: <>{metric("cache", hit)}<span>${(stats?.cost ?? 0).toFixed(2)}</span></>, title: "缓存与成本", fields: [["缓存命中率", hit], ["缓存读取 Token", (t?.cacheRead ?? 0).toLocaleString()], ["输入与缓存 Token", denominator.toLocaleString()], ["成本", `$${(stats?.cost ?? 0).toFixed(4)}`]] },
  ];
  return <div ref={root} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, minWidth: 0 }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(null); }}>
    {groups.map((group, index) => <div key={group.title} style={{ position: "relative" }}>
      <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", border: 0, borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" }}>{group.label}</button>
      {open === index && <div role="dialog" aria-label={group.title} style={{ position: "absolute", bottom: "calc(100% + 10px)", right: 0, width: 300, maxWidth: "calc(100vw - 32px)", padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", boxShadow: "0 6px 24px rgba(0,0,0,.12)", zIndex: 100, fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "-14px -14px 12px", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {index === 0 ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></> : index === 1 ? <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></> : <path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>}
            </svg>{group.title}
          </span>
          <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{index === 0 ? `${speed} tok/s` : index === 1 ? `${(t?.total ?? 0).toLocaleString()} tok` : `$${(stats?.cost ?? 0).toFixed(2)}`}</span>
        </div>
        {group.fields.map(([label, value]) => <div key={label} style={{ marginTop: 10 }}><div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{label}</div><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{value}</span><InfoCopyButton value={value}/></div></div>)}
      </div>}
    </div>)}
  </div>;
}
