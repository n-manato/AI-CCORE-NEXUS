import "server-only";

import { prisma } from "@/lib/db";
import { estimateTokens } from "./tokens";
import { ensureFts, buildFtsQuery } from "./store";

// Retrieval: given the current user input, pull the most relevant *old* (already
// summarized) messages and long-term memory back into context, bounded by token
// budget. Tiered by design — FTS5 keyword search first, LIKE as a fallback. A
// vector/embedding tier can be layered on later behind the same interface.

export interface RetrievedChunk {
  source: string; // human-readable provenance, e.g. "memory:gpu" / "history"
  text: string;
  tokens: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  tokens: number;
}

const EMPTY: RetrievalResult = { chunks: [], tokens: 0 };

// Packs ranked candidates into a token budget, in rank order.
function pack(candidates: { source: string; text: string }[], budget: number): RetrievalResult {
  const chunks: RetrievedChunk[] = [];
  let tokens = 0;
  for (const c of candidates) {
    const t = estimateTokens(c.text);
    if (tokens + t > budget) continue; // skip oversized, keep filling with smaller ones
    chunks.push({ source: c.source, text: c.text, tokens: t });
    tokens += t;
    if (tokens >= budget) break;
  }
  return { chunks, tokens };
}

// Relevant OLD (compacted) messages from this conversation.
async function searchHistory(conversationId: string, query: string, limit: number) {
  const fq = buildFtsQuery(query);
  if (!fq) return [] as { id: string; content: string }[];
  try {
    await ensureFts();
    const rows = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(
      `SELECT id, content FROM message_fts WHERE conversationId = ? AND message_fts MATCH ? ORDER BY rank LIMIT ?`,
      conversationId,
      fq,
      limit,
    );
    if (!rows.length) return [];
    // Keep only messages that are no longer in the live window (compacted), so we
    // don't duplicate what the recent-messages section already includes.
    const ids = rows.map((r) => r.id);
    const old = await prisma.message.findMany({
      where: { id: { in: ids }, compacted: true },
      select: { id: true, content: true },
    });
    const keep = new Set(old.map((m) => m.id));
    return rows.filter((r) => keep.has(r.id));
  } catch {
    // FTS unavailable → naive LIKE on the first keyword.
    const kw = (query.match(/[\p{L}\p{N}_]{3,}/gu) ?? [])[0];
    if (!kw) return [];
    return prisma.message.findMany({
      where: { conversationId, compacted: true, content: { contains: kw } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, content: true },
    });
  }
}

// Relevant long-term memory for this user (plus global memory).
async function searchMemory(userId: string, query: string, limit: number) {
  const fq = buildFtsQuery(query);
  if (!fq) return [] as { id: string; content: string; key: string }[];
  try {
    await ensureFts();
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM memory_fts WHERE (userId = ? OR userId = '') AND memory_fts MATCH ? ORDER BY rank LIMIT ?`,
      userId,
      fq,
      limit,
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const items = await prisma.memoryItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, content: true, key: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    return rows.map((r) => byId.get(r.id)).filter(Boolean) as { id: string; content: string; key: string }[];
  } catch {
    const kw = (query.match(/[\p{L}\p{N}_]{3,}/gu) ?? [])[0];
    if (!kw) return [];
    return prisma.memoryItem.findMany({
      where: { OR: [{ userId }, { userId: null }], content: { contains: kw } },
      take: limit,
      select: { id: true, content: true, key: true },
    });
  }
}

export async function retrieve(args: {
  conversationId: string;
  userId: string;
  query: string;
  budget: number;
}): Promise<RetrievalResult> {
  if (args.budget <= 0 || !args.query.trim()) return EMPTY;

  const [history, memory] = await Promise.all([
    searchHistory(args.conversationId, args.query, 20),
    searchMemory(args.userId, args.query, 10),
  ]);

  // Memory ranks ahead of old chat history (it's curated long-term knowledge).
  const candidates = [
    ...memory.map((m) => ({ source: `memory:${m.key}`, text: m.content })),
    ...history.map((h) => ({ source: "history", text: h.content })),
  ];
  return pack(candidates, args.budget);
}
