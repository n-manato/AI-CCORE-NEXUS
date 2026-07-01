import "server-only";

import { type ChatMsg, countMessagesTokens, countMessageTokens } from "./tokens";
import { modelBudget, promptBudget, DEFAULT_SYSTEM_PROMPT, REDUCTION_ORDER } from "./config";
import { truncateToTokens, packRecent } from "./budget";
import { getLiveMessages, getLatestSummary, getPinnedMemory } from "./store";
import { retrieve } from "./retriever";

// The context builder. Turns a stored conversation + the current user input into
// the bounded messages[] actually sent to the model:
//
//   system+rules → project memory → conversation summary → retrieved chunks →
//   recent messages → current user input
//
// If the assembled prompt exceeds budget, sections are trimmed in REDUCTION_ORDER
// (retrieval → oldest recent → summary → memory) until it fits.

export interface BuildResult {
  messages: ChatMsg[];
  estTokens: number;
  breakdown: Record<string, number>;
}

function storedToOpenAI(m: { role: string; content: string; metadata: string | null }): ChatMsg {
  const msg: ChatMsg = { role: m.role, content: m.content };
  if (m.metadata) {
    try {
      Object.assign(msg, JSON.parse(m.metadata));
    } catch {
      /* ignore malformed metadata */
    }
  }
  return msg;
}

export async function buildContext(args: {
  conversationId: string;
  userId: string;
  model?: string;
  systemPrompt?: string;
  rules?: string;
  currentInput: string;
}): Promise<BuildResult> {
  const b = modelBudget(args.model);
  const total = promptBudget(b);

  // 1. system + rules
  const systemText =
    (args.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT) + (args.rules ? `\n\n# Project rules\n${args.rules}` : "");
  const system: ChatMsg = { role: "system", content: truncateToTokens(systemText, b.sections.system) };

  // 2. project/user memory (pinned items always-on, within the memory budget)
  const pinned = await getPinnedMemory(args.userId);
  let memory: ChatMsg | null = null;
  if (pinned.length) {
    const memText = "# Memory\n" + pinned.map((m) => `- (${m.key}) ${m.content}`).join("\n");
    memory = { role: "system", content: truncateToTokens(memText, b.sections.memory) };
  }

  // 3. rolling conversation summary
  const sum = await getLatestSummary(args.conversationId);
  let summary: ChatMsg | null = null;
  if (sum) {
    summary = {
      role: "system",
      content: truncateToTokens(`# Conversation summary so far\n${sum.content}`, b.sections.summary),
    };
  }

  // 4. retrieval (relevant old messages + memory)
  const r = await retrieve({
    conversationId: args.conversationId,
    userId: args.userId,
    query: args.currentInput,
    budget: b.sections.retrieval,
  });
  let retrieval: ChatMsg | null = null;
  if (r.chunks.length) {
    retrieval = {
      role: "system",
      content:
        "# Relevant context (retrieved)\n" + r.chunks.map((c) => `- [${c.source}] ${c.text}`).join("\n"),
    };
  }

  // 5. recent verbatim messages (newest that fit the recent budget)
  const live = await getLiveMessages(args.conversationId);
  let recent = packRecent(live.map(storedToOpenAI), b.sections.recent);

  // 6. current user input
  const current: ChatMsg = { role: "user", content: args.currentInput };

  // ---- assemble + global fit pass ----
  const assemble = (): ChatMsg[] =>
    [system, memory, summary, retrieval, ...recent, current].filter(Boolean) as ChatMsg[];

  let estTokens = countMessagesTokens(assemble());

  // Trim in REDUCTION_ORDER until within budget.
  for (const section of REDUCTION_ORDER) {
    if (estTokens <= total) break;
    if (section === "retrieval" && retrieval) {
      retrieval = null;
    } else if (section === "recent") {
      // drop oldest recent messages one by one, never the very last turn
      while (estTokens > total && recent.length > 1) {
        recent = recent.slice(1);
        estTokens = countMessagesTokens(assemble());
      }
    } else if (section === "summary" && summary) {
      const over = estTokens - total;
      const target = Math.max(256, countMessageTokens(summary) - over - 64);
      summary = { role: "system", content: truncateToTokens(String(summary.content), target) };
    } else if (section === "memory" && memory) {
      memory = null;
    }
    estTokens = countMessagesTokens(assemble());
  }

  // Last resort: if STILL over (e.g. a single huge current input), hard-trim it.
  if (estTokens > total) {
    const others = countMessagesTokens(assemble().filter((m) => m !== current));
    current.content = truncateToTokens(args.currentInput, Math.max(256, total - others - 8));
    estTokens = countMessagesTokens(assemble());
  }

  const messages = assemble();
  return {
    messages,
    estTokens,
    breakdown: {
      system: countMessageTokens(system),
      memory: memory ? countMessageTokens(memory) : 0,
      summary: summary ? countMessageTokens(summary) : 0,
      retrieval: retrieval ? countMessageTokens(retrieval) : 0,
      recent: countMessagesTokens(recent),
      current: countMessageTokens(current),
      total: estTokens,
      budget: total,
    },
  };
}
