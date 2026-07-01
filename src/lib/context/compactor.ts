import "server-only";

import { modelBudget, promptBudget } from "./config";
import { countMessageTokens, type ChatMsg } from "./tokens";
import { packRecent } from "./budget";
import {
  getLiveMessages,
  countLiveTokens,
  getLatestSummary,
  saveSummary,
  markCompactedUpTo,
} from "./store";
import { summarize } from "./summarizer";
import { writeTaskStateFromSummary } from "./task-state";

// Auto-compaction. When a conversation's live (un-summarized) token total crosses
// the threshold, fold the OLD messages into the rolling summary and flag them
// compacted — keeping only [summary + recent] live. Also refreshes TASK_STATE.md.

export interface CompactResult {
  compacted: boolean;
  summarizedCount?: number;
  liveTokensBefore?: number;
  liveTokensAfter?: number;
}

// `model` MUST be a resolved Ollama tag (the summarizer calls Ollama with it).
export async function maybeCompact(args: {
  conversationId: string;
  model: string;
  timestamp: string; // ISO; passed in because Date.now() is fine here but keep callers explicit
  force?: boolean;
}): Promise<CompactResult> {
  const b = modelBudget(args.model);
  const liveBefore = await countLiveTokens(args.conversationId);
  if (!args.force && liveBefore <= b.compactThreshold) return { compacted: false };

  const liveRaw = await getLiveMessages(args.conversationId);
  if (liveRaw.length < 2) return { compacted: false };

  // Decide the recent window we KEEP verbatim; everything older gets summarized.
  const asChat: (ChatMsg & { _id: string; _createdAt: Date })[] = liveRaw.map((m) => ({
    role: m.role,
    content: m.content,
    _id: m.id,
    _createdAt: m.createdAt,
  }));
  const keep = packRecent(asChat as unknown as ChatMsg[], b.sections.recent) as unknown as typeof asChat;
  const keepIds = new Set(keep.map((k) => k._id));

  // The older prefix to compact.
  let toCompact = asChat.filter((m) => !keepIds.has(m._id));
  // Don't leave a dangling tool result at the top of the kept window: if the
  // first kept message is a tool turn, pull it (and its triggering assistant)
  // into the compacted set so we never split a tool_call/result pair.
  while (keep.length && (keep[0]!.role === "tool")) {
    const moved = keep.shift()!;
    toCompact.push(moved);
  }
  toCompact = toCompact.sort((a, b2) => a._createdAt.getTime() - b2._createdAt.getTime());
  if (!toCompact.length) return { compacted: false };

  const prev = await getLatestSummary(args.conversationId);
  const inputBudget = Math.floor(promptBudget(b) * 0.7);

  const newSummary = await summarize({
    model: args.model,
    previousSummary: prev?.content,
    messages: toCompact.map((m) => ({ role: m.role, content: String(m.content) })),
    inputBudget,
  });

  const last = toCompact[toCompact.length - 1]!;
  await saveSummary({
    conversationId: args.conversationId,
    content: newSummary,
    coversUpTo: last._createdAt,
    messageCount: toCompact.length,
  });
  await markCompactedUpTo(args.conversationId, last._id);

  // Snapshot durable project state from the fresh summary.
  await writeTaskStateFromSummary(newSummary, {
    conversationId: args.conversationId,
    reason: "before compaction",
    timestamp: args.timestamp,
  });

  const liveAfter = await countLiveTokens(args.conversationId);
  return {
    compacted: true,
    summarizedCount: toCompact.length,
    liveTokensBefore: liveBefore,
    liveTokensAfter: liveAfter,
  };
}
