import type { AgentMessage, AgentUsage, SessionEntry } from "./types";

export interface SessionFileStats {
  traceSteps?: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

function emptyStats(): SessionFileStats {
  return {
    traceSteps: 1,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function addUsage(stats: SessionFileStats, usage?: AgentUsage): void {
  if (!usage) return;
  stats.tokens.input += usage.input ?? 0;
  stats.tokens.output += usage.output ?? 0;
  stats.tokens.cacheRead += usage.cacheRead ?? 0;
  stats.tokens.cacheWrite += usage.cacheWrite ?? 0;
  stats.cost += usage.cost?.total ?? 0;
}

function addMessage(stats: SessionFileStats, message: AgentMessage): void {
  stats.traceSteps = (stats.traceSteps ?? 1) + (message.role === "assistant" ? message.content.filter((block) => ["text", "thinking", "toolCall"].includes(block.type)).length + (message.errorMessage ? 1 : 0) : 1);
  stats.totalMessages += 1;
  if (message.role === "user") {
    stats.userMessages += 1;
  } else if (message.role === "toolResult") {
    stats.toolResults += 1;
    addUsage(stats, message.usage);
  } else if (message.role === "assistant") {
    stats.assistantMessages += 1;
    if (Array.isArray(message.content)) {
      stats.toolCalls += message.content.filter((c) => c.type === "toolCall").length;
    }
    addUsage(stats, message.usage);
  }
}

function finishStats(stats: SessionFileStats): SessionFileStats {
  stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite;
  return stats;
}

function computeMessageStats(messages: AgentMessage[]): SessionFileStats {
  const stats = emptyStats();
  for (const message of messages) {
    if (message.role !== "custom") addMessage(stats, message);
  }
  return finishStats(stats);
}

export function mergeSessionStats(
  fileStats: SessionFileStats | undefined,
  loadedMessages: AgentMessage[],
  currentMessages: AgentMessage[],
): SessionFileStats {
  const current = computeMessageStats(currentMessages);
  if (!fileStats) return current;

  const loaded = computeMessageStats(loadedMessages);
  const delta = (now: number, before: number) => Math.max(0, now - before);
  const tokens = {
    input: fileStats.tokens.input + delta(current.tokens.input, loaded.tokens.input),
    output: fileStats.tokens.output + delta(current.tokens.output, loaded.tokens.output),
    cacheRead: fileStats.tokens.cacheRead + delta(current.tokens.cacheRead, loaded.tokens.cacheRead),
    cacheWrite: fileStats.tokens.cacheWrite + delta(current.tokens.cacheWrite, loaded.tokens.cacheWrite),
    total: 0,
  };
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    traceSteps: (fileStats.traceSteps ?? 1) + delta(current.traceSteps ?? 1, loaded.traceSteps ?? 1),
    userMessages: fileStats.userMessages + delta(current.userMessages, loaded.userMessages),
    assistantMessages: fileStats.assistantMessages + delta(current.assistantMessages, loaded.assistantMessages),
    toolCalls: fileStats.toolCalls + delta(current.toolCalls, loaded.toolCalls),
    toolResults: fileStats.toolResults + delta(current.toolResults, loaded.toolResults),
    totalMessages: fileStats.totalMessages + delta(current.totalMessages, loaded.totalMessages),
    tokens,
    cost: fileStats.cost + delta(current.cost, loaded.cost),
  };
}

/**
 * Aggregate usage across ALL entries in a session file.
 *
 * Mirrors the SDK's `AgentSession.getSessionStats()`: besides assistant
 * (and tool-result) messages, this also counts usage recorded on compaction
 * and branch-summary entries. Compaction only appends a summary entry — the
 * summarized history stays in the file — so these totals grow monotonically
 * for the life of the session. Totals computed over the active context alone
 * (the compaction-aware message list) shrink whenever old history is
 * summarized away, which is what made the UI token/cost counters appear to be
 * reset after compaction.
 */
export function computeSessionStats(entries: SessionEntry[]): SessionFileStats {
  const stats = emptyStats();

  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      stats.traceSteps = (stats.traceSteps ?? 1) + 1;
      addUsage(stats, entry.usage);
      continue;
    }
    if (entry.type === "custom_message") stats.traceSteps = (stats.traceSteps ?? 1) + 1;
    if (entry.type !== "message") continue;
    addMessage(stats, entry.message);
  }

  return finishStats(stats);
}
