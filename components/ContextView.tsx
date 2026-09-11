"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ChartTooltip } from "./ChartTooltip";
import type { AgentMessage } from "@/lib/types";
import type { ToolEntry } from "@/lib/tool-presets";
import type { ContextUsage } from "./ContextUsageButton";

type Item = { name: string; text: string };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: 16, minWidth: 0 };
const fmt = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString();
function body(message: AgentMessage): string {
  if (message.role === "bashExecution") return message.command + "\n" + message.output;
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "thinking") return (block.deferred ? "[历史思考预览]\n" : "") + block.thinking;
    if (block.type === "toolCall") return block.toolName + "\n" + (block.rawInput || JSON.stringify(block.input, null, 2));
    return "[图片：不计入文本字符统计]";
  }).join("\n");
}
export function ContextView({ messages, systemPrompt, tools, usage, onCompact, compacting, onAbort, busy }: {
  messages: AgentMessage[]; systemPrompt: string | null; tools?: ToolEntry[] | null;
  usage: ContextUsage | null; hasEarlier: boolean; onCompact: () => void;
  compacting: boolean; onAbort: () => void; busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const data = useMemo(() => {
    const groups: { name: string; color: string; items: Item[] }[] = [
      { name: "系统提示词", color: "#8996a3", items: systemPrompt == null ? [] : [{ name: "当前运行时快照", text: systemPrompt }] },
      { name: "工具定义", color: "#ac8fe3", items: (tools ?? []).filter((t) => t.active).map((t) => ({ name: t.name, text: t.description + "\n" + JSON.stringify(t.parameters ?? {}, null, 2) })) },
      { name: "用户消息", color: "#6A9FCC", items: [] },
      { name: "注入与摘要", color: "#61ad8a", items: [] },
      { name: "助手消息", color: "#8290d0", items: [] },
      { name: "工具结果", color: "#c9a366", items: [] },
    ];
    const requests: { label: string; input: number; output: number; cache: number; cost: number }[] = [];
    let round = 0;
    messages.forEach((m, i) => {
      if (m.role === "user") round++;
      const group = m.role === "user" ? 2 : m.role === "custom" ? 3 : m.role === "assistant" ? 4 : 5;
      groups[group].items.push({ name: m.role === "custom" ? m.customType : m.role === "toolResult" ? m.toolName ?? "工具结果" : `消息 ${i + 1}`, text: body(m) });
      if (m.role === "assistant" && m.usage) {
        requests.push({ label: `第 ${round} 轮 · ${m.model}`, input: m.usage.input + m.usage.cacheRead + m.usage.cacheWrite, output: m.usage.output, cache: m.usage.cacheRead, cost: m.usage.cost.total });
      }
    });
    return { groups, requests, round };
  }, [messages, systemPrompt, tools]);
  const sizes = data.groups.map((g) => g.items.reduce((n, item) => n + item.text.length, 0));
  const total = sizes.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...data.requests.map((r) => r.input));
  const cost = data.requests.reduce((n, r) => n + r.cost, 0);
  const allInput = data.requests.reduce((n, r) => n + r.input, 0);
  const cached = data.requests.reduce((n, r) => n + r.cache, 0);
  const current = data.groups[selected];
  const events = messages.filter((m) => m.role === "custom");
  return <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 20, color: "var(--text)", fontSize: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <strong style={{ fontSize: 16 }}>上下文洞察</strong>
      <button type="button" disabled={!compacting && busy} onClick={compacting ? onAbort : onCompact} style={{ marginLeft: "auto", padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>{compacting ? "停止压缩" : "压缩上下文"}</button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
      {[
        ["上下文用量", usage?.percent == null ? "—" : usage.percent.toFixed(1) + "%", fmt(usage?.tokens) + " / " + fmt(usage?.contextWindow)],
        ["已加载轮次 / 请求", data.round + " / " + data.requests.length, "请求数仅统计有 usage 的助手消息"],
        ["缓存命中", allInput ? (cached / allInput * 100).toFixed(1) + "%" : "—", "缓存读取 / 已记录输入 token"],
        ["已记录费用", "$" + cost.toFixed(4), "已加载消息的 usage 费用"],
      ].map(([label, value, note]) => <div key={label} style={card}><div style={{ color: "var(--text-muted)" }}>{label}</div><div style={{ fontSize: 23, margin: "10px 0", fontWeight: 600 }}>{value}</div><div style={{ color: "var(--text-dim)", fontSize: 11 }}>{note}</div></div>)}
    </div>
    <section style={{ ...card, marginBottom: 16 }}>
      <strong>可见内容组成</strong><span style={{ marginLeft: 10, color: "var(--text-dim)" }}>按文本字符数统计，非 token 占比</span>
      <div style={{ display: "flex", height: 12, gap: 2, margin: "16px 0", overflow: "hidden", borderRadius: 4 }}>{data.groups.map((g, i) => sizes[i] > 0 && <ChartTooltip key={g.name} text={g.name + "\n" + fmt(sizes[i]) + " 字符 · " + (total ? (sizes[i] / total * 100).toFixed(1) : "0") + "%"} style={{ flex: sizes[i], background: g.color }} />)}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{data.groups.map((g, i) => <button key={g.name} onClick={() => setSelected(i)} style={{ border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}><span style={{ color: g.color }}>●</span> {g.name} · {fmt(sizes[i])} ({total ? (sizes[i] / total * 100).toFixed(1) : 0}%)</button>)}</div>
    </section>
    <section style={{ ...card, marginBottom: 16 }}>
      <strong>请求输入趋势</strong><span style={{ marginLeft: 10, color: "var(--text-dim)" }}>已记录的输入 token（含缓存）</span>
      <div style={{ height: 110, display: "flex", alignItems: "flex-end", gap: 4, overflowX: "auto", marginTop: 16 }}>{data.requests.map((r, i) => <ChartTooltip key={i} text={r.label + "\n输入 " + fmt(r.input) + "\n输出 " + fmt(r.output) + "\n缓存读取 " + fmt(r.cache) + "\n费用 $" + r.cost.toFixed(4)} style={{ flex: "1 0 12px", maxWidth: 32, height: Math.max(2, r.input / max * 100), background: "var(--accent)", borderRadius: "3px 3px 0 0" }} />)}{!data.requests.length && <span style={{ color: "var(--text-dim)" }}>暂无请求用量记录</span>}</div>
    </section>
    <section style={{ ...card, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}><strong>内容浏览器</strong><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索当前分类…" aria-label="搜索上下文" style={{ marginLeft: "auto", padding: "6px 8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 6 }} /></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "14px 0" }}>{data.groups.map((g, i) => <button key={g.name} onClick={() => setSelected(i)} style={{ border: 0, borderRadius: 5, padding: "6px 10px", background: selected === i ? "var(--bg-selected)" : "transparent", color: "var(--text)", cursor: "pointer" }}>{g.name} {g.items.length}</button>)}</div>
      {current.items.filter((item) => (item.name + item.text).toLowerCase().includes(query.toLowerCase())).map((item, i) => <details key={selected + "-" + i} style={{ borderTop: "1px solid var(--border)", padding: "9px 0" }}><summary style={{ cursor: "pointer" }}>{item.name} <span style={{ color: "var(--text-dim)" }}>· {fmt(item.text.length)} 字符</span></summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6, maxHeight: 400, overflow: "auto" }}>{item.text || "（空）"}</pre></details>)}
      {!current.items.length && <p style={{ color: "var(--text-dim)" }}>暂无可用记录</p>}
    </section>
    <section style={card}><strong>已记录的上下文事件</strong>{events.map((m, i) => <details key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}><summary style={{ cursor: "pointer" }}>{m.role === "custom" ? m.customType : ""} · {m.timestamp ? new Date(m.timestamp).toLocaleString() : "时间未知"}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body(m)}</pre></details>)}{!events.length && <p style={{ color: "var(--text-dim)" }}>没有已记录的注入或压缩事件</p>}</section>
  </div>;
}
