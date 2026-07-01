import "server-only";

// Token estimation.
//
// We deliberately avoid a native tokenizer dependency. Budgeting only needs a
// CONSERVATIVE estimate (over-counting is safe — it just trims a little early;
// under-counting is dangerous — it overflows the model). We therefore use a
// per-character heuristic tuned to slightly over-estimate, with a heavier weight
// for CJK (which is ~1 token/char) and a fixed per-message envelope overhead.
//
// To swap in a real tokenizer later, replace estimateTokens() — every other
// module depends only on this function.

const CHARS_PER_TOKEN = 3.5; // conservative (real English ~4); over-estimates slightly
const PER_MESSAGE_OVERHEAD = 4; // role + delimiters added by chat templates

// Rough count of CJK / full-width characters, which tokenize at ~1 token each.
function cjkCount(text: string): number {
  const m = text.match(
    /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/g,
  );
  return m ? m.length : 0;
}

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const cjk = cjkCount(text);
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / CHARS_PER_TOKEN);
}

export interface ChatMsg {
  role: string;
  content: unknown; // string | parts[] | null (tool turns)
  [k: string]: unknown;
}

// Flattens OpenAI message content (string | content-parts | null) to text for
// estimation only — never mutates the message.
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
      .join("\n");
  }
  return "";
}

export function countMessageTokens(msg: ChatMsg): number {
  let n = estimateTokens(messageText(msg.content)) + PER_MESSAGE_OVERHEAD;
  // Tool calls/results carry JSON arguments that also cost tokens.
  if (msg.tool_calls) n += estimateTokens(JSON.stringify(msg.tool_calls));
  if (msg.name) n += estimateTokens(String(msg.name));
  return n;
}

export function countMessagesTokens(msgs: ChatMsg[]): number {
  return msgs.reduce((sum, m) => sum + countMessageTokens(m), 0);
}
