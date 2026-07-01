import "server-only";

import { prisma } from "@/lib/db";
import { estimateTokens } from "./tokens";

// Persistence layer for the context system: conversations, messages, rolling
// summaries, and long-term memory — plus an SQLite FTS5 index for retrieval.
//
// Design rule: EVERYTHING is stored here. What gets sent to the model is decided
// later by the context builder. Compacted messages are NOT deleted; they are
// flagged `compacted=true` and stay searchable via FTS so retrieval can pull a
// relevant old turn back in on demand.

// ---- FTS5 bootstrap (idempotent) -------------------------------------------

let ftsReady = false;

export async function ensureFts(): Promise<void> {
  if (ftsReady) return;
  await prisma.$executeRawUnsafe(
    `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(id UNINDEXED, conversationId UNINDEXED, content, tokenize='porter unicode61')`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, userId UNINDEXED, scope UNINDEXED, content, tokenize='porter unicode61')`,
  );
  ftsReady = true;
}

// Turns arbitrary user text into a safe FTS5 MATCH expression: keep word/CJK
// runs, quote each term (so punctuation can't inject FTS operators), OR them.
export function buildFtsQuery(text: string): string | null {
  const terms = (text.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((t) => t.length >= 2)
    .slice(0, 24)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.length ? terms.join(" OR ") : null;
}

async function ftsIndexMessage(id: string, conversationId: string, content: string): Promise<void> {
  try {
    await ensureFts();
    await prisma.$executeRawUnsafe(
      `INSERT INTO message_fts(id, conversationId, content) VALUES (?, ?, ?)`,
      id,
      conversationId,
      content,
    );
  } catch {
    /* retrieval index is best-effort; never block a write */
  }
}

async function ftsIndexMemory(id: string, userId: string | null, scope: string, content: string): Promise<void> {
  try {
    await ensureFts();
    await prisma.$executeRawUnsafe(`DELETE FROM memory_fts WHERE id = ?`, id);
    await prisma.$executeRawUnsafe(
      `INSERT INTO memory_fts(id, userId, scope, content) VALUES (?, ?, ?, ?)`,
      id,
      userId ?? "",
      scope,
      content,
    );
  } catch {
    /* best-effort */
  }
}

// ---- Conversations ----------------------------------------------------------

export function createConversation(args: { userId: string; title?: string; model?: string }) {
  return prisma.conversation.create({
    data: { userId: args.userId, title: args.title, model: args.model },
  });
}

export function getConversation(id: string) {
  return prisma.conversation.findUnique({ where: { id } });
}

// ---- Messages ---------------------------------------------------------------

export interface AddMessageArgs {
  conversationId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  compacted?: boolean;
}

export async function addMessage(args: AddMessageArgs) {
  const tokenCount = estimateTokens(args.content);
  const msg = await prisma.message.create({
    data: {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      tokenCount,
      metadata: args.metadata ? JSON.stringify(args.metadata) : null,
      compacted: args.compacted ?? false,
    },
  });
  await prisma.conversation.update({ where: { id: args.conversationId }, data: {} }); // bump updatedAt
  await ftsIndexMessage(msg.id, msg.conversationId, args.content);
  return msg;
}

export type StoredMessage = Awaited<ReturnType<typeof addMessage>>;

// Live (un-compacted) messages, oldest first — the raw recent history.
export function getLiveMessages(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId, compacted: false },
    orderBy: { createdAt: "asc" },
  });
}

export function getAllMessages(conversationId: string) {
  return prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
}

export async function countLiveTokens(conversationId: string): Promise<number> {
  const r = await prisma.message.aggregate({
    where: { conversationId, compacted: false },
    _sum: { tokenCount: true },
  });
  return r._sum.tokenCount ?? 0;
}

export async function markCompactedUpTo(conversationId: string, uptoId: string): Promise<number> {
  const upto = await prisma.message.findUnique({ where: { id: uptoId } });
  if (!upto) return 0;
  const r = await prisma.message.updateMany({
    where: { conversationId, compacted: false, createdAt: { lte: upto.createdAt } },
    data: { compacted: true },
  });
  return r.count;
}

// ---- Summaries --------------------------------------------------------------

export function getLatestSummary(conversationId: string) {
  return prisma.conversationSummary.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
  });
}

export function saveSummary(args: {
  conversationId: string;
  content: string;
  coversUpTo: Date;
  messageCount: number;
}) {
  return prisma.conversationSummary.create({
    data: {
      conversationId: args.conversationId,
      content: args.content,
      coversUpTo: args.coversUpTo,
      messageCount: args.messageCount,
      tokenCount: estimateTokens(args.content),
    },
  });
}

// ---- Memory -----------------------------------------------------------------

export async function upsertMemory(args: {
  key: string;
  content: string;
  userId?: string | null;
  scope?: string;
  source?: string;
  pinned?: boolean;
}) {
  const scope = args.scope ?? "project";
  const userId = args.userId ?? null;
  const existing = await prisma.memoryItem.findFirst({ where: { key: args.key, userId, scope } });
  const data = {
    key: args.key,
    content: args.content,
    userId,
    scope,
    source: args.source,
    pinned: args.pinned ?? false,
    tokenCount: estimateTokens(args.content),
  };
  const item = existing
    ? await prisma.memoryItem.update({ where: { id: existing.id }, data })
    : await prisma.memoryItem.create({ data });
  await ftsIndexMemory(item.id, userId, scope, args.content);
  return item;
}

export function getPinnedMemory(userId: string) {
  return prisma.memoryItem.findMany({
    where: { pinned: true, OR: [{ userId }, { userId: null }] },
    orderBy: { updatedAt: "desc" },
  });
}

export function listMemory(userId: string) {
  return prisma.memoryItem.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { updatedAt: "desc" },
  });
}
