import "server-only";

import { type ChatMsg, countMessagesTokens, countMessageTokens, messageText } from "./tokens";
import { modelBudget, promptBudget } from "./config";
import { summarize } from "./summarizer";

// Transparent, STATELESS compaction for the OpenAI-compatible passthrough
// (/v1/chat/completions). When a client (e.g. Cline) sends a messages[] that
// would overflow the model, we fold the older middle of the conversation into a
// single summary message — keeping the system prompt and the recent window
// verbatim — so the request fits instead of failing with a context overflow.
//
// Safety: we never split a tool_call/tool_result pair. The recent window is
// snapped back to a `user` boundary, and the entire summarized middle becomes
// prose, so no dangling tool turns can remain. Summaries are cached by prefix so
// a long multi-turn session doesn't re-summarize the same history every turn.

const cache = new Map<string, string>();
const MAX_CACHE = 200;

function prefixKey(head: ChatMsg[], middle: ChatMsg[]): string {
  // Cheap, collision-resistant-enough key: role + length + edges of each msg.
  let h = 0;
  const sig = [...head, ...middle]
    .map((m) => {
      const t = messageText(m.content);
      return `${m.role}:${t.length}:${t.slice(0, 48)}:${t.slice(-48)}`;
    })
    .join("|");
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return `${middle.length}:${h}`;
}

export interface TransparentResult {
  messages: ChatMsg[];
  compacted: boolean;
  before: number;
  after: number;
}

export async function maybeCompactMessages(args: {
  messages: ChatMsg[];
  model: string; // app id, for budget lookup
  tag: string; // Ollama tag, for the summarizer call
}): Promise<TransparentResult> {
  const b = modelBudget(args.model);
  const total = promptBudget(b);
  const before = countMessagesTokens(args.messages);
  if (before <= b.compactThreshold) return { messages: args.messages, compacted: false, before, after: before };

  const msgs = args.messages;

  // Keep leading system message(s) verbatim.
  let s = 0;
  while (s < msgs.length && msgs[s]!.role === "system") s++;
  const head = msgs.slice(0, s);
  const rest = msgs.slice(s);

  // Choose the recent window (newest messages within the recent budget).
  let keepFrom = rest.length;
  let tok = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    tok += countMessageTokens(rest[i]!);
    keepFrom = i;
    if (tok > b.sections.recent && rest.length - i > 1) {
      keepFrom = i + 1;
      break;
    }
  }
  // Snap the window start to a `user` boundary so we never keep a tool result
  // whose triggering assistant turn is in the summarized middle.
  while (keepFrom > 0 && keepFrom < rest.length && rest[keepFrom]!.role !== "user") keepFrom--;

  const middle = rest.slice(0, keepFrom);
  let recent = rest.slice(keepFrom);
  if (!middle.length) return { messages: msgs, compacted: false, before, after: before };

  // Summarize the middle (cached by prefix).
  const key = prefixKey(head, middle);
  let summary = cache.get(key);
  if (!summary) {
    summary = await summarize({
      model: args.tag,
      messages: middle.map((m) => ({
        role: m.role,
        content: messageText(m.content) || (m.tool_calls ? JSON.stringify(m.tool_calls) : ""),
      })),
      inputBudget: Math.floor(total * 0.7),
    });
    cache.set(key, summary);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  }

  const summaryMsg: ChatMsg = {
    role: "system",
    content: `# Summary of earlier conversation (auto-compacted)\n${summary}`,
  };

  let out: ChatMsg[] = [...head, summaryMsg, ...recent];
  let after = countMessagesTokens(out);
  // If still over (very long recent window), drop oldest recent turns.
  while (after > total && recent.length > 1) {
    recent = recent.slice(1);
    out = [...head, summaryMsg, ...recent];
    after = countMessagesTokens(out);
  }
  return { messages: out, compacted: true, before, after };
}
