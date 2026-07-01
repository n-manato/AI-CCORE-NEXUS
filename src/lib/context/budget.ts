import "server-only";

import { estimateTokens, countMessageTokens, type ChatMsg } from "./tokens";

// Low-level budget primitives used by the context builder.

// Truncates text to roughly maxTokens (keeps the head, which holds the most
// important/structural content for a summary).
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  const approxChars = Math.max(0, Math.floor(maxTokens * 3.5));
  return text.slice(0, approxChars).trimEnd() + " …[truncated]";
}

// Keeps as many of the NEWEST messages as fit in `budget`, returned in
// chronological order. `messages` must be chronological (oldest first).
export function packRecent(messages: ChatMsg[], budget: number): ChatMsg[] {
  const kept: ChatMsg[] = [];
  let tokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = countMessageTokens(messages[i]!);
    if (tokens + t > budget && kept.length > 0) break;
    kept.push(messages[i]!);
    tokens += t;
  }
  return kept.reverse();
}
