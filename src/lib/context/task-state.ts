import "server-only";

import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

// TASK_STATE.md — durable, human-readable project state at the repo root.
//
// In Claude Code / Cline-style agents, anything held ONLY in the conversation is
// lost after a compaction. So just before we compact (and after big changes) we
// snapshot the structured summary here, where it survives independently of the
// chat. The summarizer already emits the matching ## sections.

const TASK_STATE_PATH = process.env.TASK_STATE_PATH ?? path.join(process.cwd(), "TASK_STATE.md");

export function taskStatePath(): string {
  return TASK_STATE_PATH;
}

// Writes TASK_STATE.md from a structured summary (the summarizer's ## sections).
export async function writeTaskStateFromSummary(
  summaryMarkdown: string,
  meta: { conversationId?: string; reason?: string; timestamp: string },
): Promise<void> {
  const header =
    `# TASK_STATE\n\n` +
    `_Auto-generated ${meta.reason ?? "before compaction"} · ${meta.timestamp}` +
    (meta.conversationId ? ` · conversation \`${meta.conversationId}\`` : "") +
    `_\n\n` +
    `> Source of truth for project state. Survives conversation compaction.\n\n`;
  const body = summaryMarkdown.trim() || "_(empty summary)_";
  try {
    await writeFile(TASK_STATE_PATH, header + body + "\n");
  } catch {
    /* never let a state write break the request path */
  }
}

// Appends a one-line event to a rolling history at the bottom is intentionally
// avoided (keeps the file a clean snapshot); callers wanting an audit trail can
// use this explicit helper.
export async function appendTaskStateNote(note: string, timestamp: string): Promise<void> {
  try {
    await appendFile(TASK_STATE_PATH, `\n<!-- ${timestamp}: ${note} -->\n`);
  } catch {
    /* best-effort */
  }
}
