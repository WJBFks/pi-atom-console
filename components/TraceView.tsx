"use client";

import { useMemo, useState } from "react";
import type { AgentMessage } from "@/lib/types";

type Row = { id: string; round: number; kind: string; text: string; time?: number; color: string };
export function TraceView({ messages, streaming, systemPrompt }: { messages: AgentMessage[]; streaming?: AgentMessage | null; systemPrompt?: string | null }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    let round = 0;
    const result: Row[] = [{
      id: "system-prompt", round: 0, kind: "系统", color: "#87929c",
      text: systemPrompt == null
        ? "系统提示词暂不可用：历史会话未必保存了当时的系统提示词。"
        : "当前系统提示词（运行时快照，不代表历史每轮的实际请求）\n\n" + (systemPrompt || "（空）"),
    }];
    [...messages, ...(streaming ? [streaming] : [])].forEach((message, index) => {
      if (message.role === "user") round++;
      const add = (kind: string, text: string, color: string) => result.push({ id: `${index}-${result.length}`, round, kind, text, time: message.timestamp, color });
      if (message.role === "assistant") {
        message.content.forEach((block) => {
          if (block.type === "thinking") add("思考", block.thinking, "#9277b5");
          if (block.type === "text") add("助手", block.text, "#7a83c4");
          if (block.type === "toolCall") add("调用", block.toolName + "\n" + (block.rawInput || JSON.stringify(block.input, null, 2)), "#ba9452");
        });
        if (message.errorMessage) add("错误", message.errorMessage, "#dc6666");
      } else if (message.role === "bashExecution") {
        add("终端", message.command + "\n" + message.output, "#ba9452");
      } else {
        const text = typeof message.content === "string" ? message.content : message.content.map((block) => block.type === "text" ? block.text : "[图片]").join("\n");
        add(message.role === "user" ? "用户" : message.role === "toolResult" ? (message.isError ? "错误" : "结果") : message.customType === "compaction" ? "压缩摘要" : "注入", message.role === "toolResult" ? (message.toolName ?? "") + "\n" + text : message.role === "custom" ? "来源：" + message.customType + "\n" + text : text, message.role === "user" ? "#6A9FCC" : message.role === "toolResult" ? "#ba9452" : "#62a982");
      }
    });
    return result;
  }, [messages, streaming, systemPrompt]);
  const filtered = rows.filter((row) => (row.kind + row.text).toLowerCase().includes(query.toLowerCase()));
  return <section style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", color: "var(--text)", fontSize: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 14px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <span>{Math.max(0, ...rows.map((row) => row.round))} 轮</span><span>{rows.length} 条事件</span><span>{rows.filter((row) => row.kind === "调用").length} 次调用</span>
      <input aria-label="搜索轨迹" placeholder="搜索轨迹…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginLeft: "auto", width: 180, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)" }} />
    </div>
    <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
      {filtered.map((row, index) => <details key={row.id} style={{
        borderTop: row.round > 0 && (index === 0 || filtered[index - 1].round !== row.round)
          ? "2px solid var(--accent)"
          : index === 0 ? "none" : "1px solid var(--border)",
        marginTop: row.round > 0 && (index === 0 || filtered[index - 1].round !== row.round) ? 10 : 0,
      }}>
        <summary style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", cursor: "pointer", listStyle: "none", background: row.kind === "用户" ? "var(--user-bg)" : undefined }}>
          <span style={{ width: 44, flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{row.round ? `第 ${row.round} 轮` : "初始"}</span>
          <span style={{ flexShrink: 0, padding: "2px 5px", borderRadius: 3, background: `color-mix(in srgb, ${row.color} 15%, transparent)`, color: row.color }}>{row.kind}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.text}</span>
          <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{row.time ? new Date(row.time).toLocaleTimeString() : ""}</span>
        </summary>
        <pre style={{ margin: 0, padding: "12px 24px 16px 82px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.6, background: "var(--bg-hover)" }}>{row.text}</pre>
      </details>)}
      {!filtered.length && <div style={{ padding: 24, color: "var(--text-dim)" }}>{query ? "没有匹配的事件" : "暂无轨迹"}</div>}
    </div>
  </section>;
}
