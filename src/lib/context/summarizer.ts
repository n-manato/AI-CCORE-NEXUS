import "server-only";

import { ollamaChat } from "@/lib/ollama";
import { estimateTokens } from "./tokens";

// Summarization: compress old conversation turns into a compact, STRUCTURED
// summary that preserves the things an agent must never lose. Reuses the
// conversation's own (already-resident) model so we don't load a second model
// and blow up VRAM.

// The structure mirrors TASK_STATE.md so a summary can directly drive it.
export const SUMMARY_SECTIONS = [
  "Current Goal",
  "Completed",
  "In Progress",
  "Important Decisions",
  "User Constraints",
  "Edited Files",
  "Current Errors",
  "Next Steps",
  "Do-Not-Forget",
] as const;

const SYSTEM_PROMPT =
  "You are a context-compression engine for a long-running AI coding session. " +
  "Merge the PREVIOUS SUMMARY with the NEW MESSAGES into a single updated summary. " +
  "Preserve every durable fact: the current goal, decisions made, user constraints/preferences, " +
  "files edited, errors currently occurring, and what to do next. Drop chit-chat and redundant detail. " +
  "Be specific (keep names, paths, flags, numbers). Output ONLY the summary using EXACTLY these markdown sections, " +
  "in this order, each as a short bullet list (write 'none' if empty):\n" +
  SUMMARY_SECTIONS.map((s) => `## ${s}`).join("\n");

function renderForSummary(messages: { role: string; content: string }[], perMsgCap: number): string {
  return messages
    .map((m) => {
      const body = m.content.length > perMsgCap ? m.content.slice(0, perMsgCap) + " …[truncated]" : m.content;
      return `[${m.role}] ${body}`;
    })
    .join("\n\n");
}

async function summarizeOnce(model: string, previousSummary: string, chunkText: string): Promise<string> {
  const user =
    (previousSummary ? `PREVIOUS SUMMARY:\n${previousSummary}\n\n` : "") +
    `NEW MESSAGES:\n${chunkText}`;
  const res = (await ollamaChat(model, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    stream: false,
    // Keep the summary itself bounded.
    options: { num_predict: 1024, temperature: 0.2 },
  })) as { choices?: { message?: { content?: string } }[] };
  return res.choices?.[0]?.message?.content?.trim() ?? previousSummary;
}

// Rolling summarize: fold messages in budget-sized chunks so the summarization
// call itself never overflows the model's context window.
export async function summarize(args: {
  model: string;
  previousSummary?: string;
  messages: { role: string; content: string }[];
  inputBudget: number; // max tokens to feed per call (already net of output reserve)
}): Promise<string> {
  let running = args.previousSummary?.trim() ?? "";
  if (!args.messages.length) return running;

  const perMsgCap = Math.max(2000, Math.floor(args.inputBudget * 3)); // chars; lossy guard for giant single turns
  const chunks: { role: string; content: string }[][] = [];
  let cur: { role: string; content: string }[] = [];
  let curTokens = 0;
  const headroom = Math.max(1024, args.inputBudget - estimateTokens(running) - 256);

  for (const m of args.messages) {
    const t = Math.min(estimateTokens(m.content), perMsgCap / 3);
    if (curTokens + t > headroom && cur.length) {
      chunks.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(m);
    curTokens += t;
  }
  if (cur.length) chunks.push(cur);

  for (const chunk of chunks) {
    running = await summarizeOnce(args.model, running, renderForSummary(chunk, perMsgCap));
  }
  return running;
}
