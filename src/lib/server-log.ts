import "server-only";

import { appendFile, mkdir, open, stat } from "node:fs/promises";
import path from "node:path";

// Durable, file-based server request log (info + error), one JSON line per
// gateway request. This is the data source for the admin "Server Logs" page,
// which tails it live (SSE) so model/backend errors are visible without digging
// through the dev terminal's scrollback. Written from the single chokepoint
// recordUsage(); errors carry the classified gateway code/model/message.
//
// Best-effort like gateway-log.ts: it never throws into, nor blocks, a request.
// The dedicated gateway-errors.log archive is kept separately (gateway-log.ts).

const LOG_DIR = process.env.GATEWAY_LOG_DIR ?? path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "server.log");

// Cap how much of the (un-rotated) file we read from the tail, so a large log
// never blows up memory. ~512KB comfortably covers a few thousand recent lines.
const MAX_READ_BYTES = 512 * 1024;

let dirReady = false;

export type LogLevel = "info" | "error";

export interface ServerLogRecord {
  ts: string;
  level: LogLevel;
  path: string;
  apiName?: string;
  category?: string;
  userId?: string;
  model?: string;
  /** HTTP status the gateway returned to the client. */
  status?: number;
  /** Gateway error code on failure (e.g. context_length_exceeded). */
  code?: string;
  latencyMs?: number;
  /** Upstream / exception message, trimmed. */
  message?: string;
  stream?: boolean;
}

/** Appends one JSON line to logs/server.log. Fire-and-forget; never throws. */
export function logServerEvent(entry: Omit<ServerLogRecord, "ts">): void {
  const record: ServerLogRecord = { ts: new Date().toISOString(), ...entry };
  const line = JSON.stringify(record) + "\n";

  void (async () => {
    try {
      if (!dirReady) {
        await mkdir(LOG_DIR, { recursive: true });
        dirReady = true;
      }
      await appendFile(LOG_FILE, line);
    } catch {
      /* swallow: a failed log write must not affect the request */
    }
  })();
}

function parseLines(text: string): ServerLogRecord[] {
  const out: ServerLogRecord[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const r = JSON.parse(line) as ServerLogRecord;
      if (r && typeof r.ts === "string") out.push(r);
    } catch {
      /* skip a partial/corrupt line (e.g. a truncated tail read) */
    }
  }
  return out;
}

export interface ReadOpts {
  /** Only return entries at this level (e.g. "error"). */
  level?: LogLevel;
  /** Only return entries with ts >= sinceIso. */
  sinceIso?: string;
}

// Reads the tail of server.log and returns parsed entries, NEWEST FIRST.
// Returns [] when the file does not exist yet.
export async function readRecentServerLog(
  limit = 200,
  opts: ReadOpts = {},
): Promise<ServerLogRecord[]> {
  let fh;
  try {
    const info = await stat(LOG_FILE);
    const start = Math.max(0, info.size - MAX_READ_BYTES);
    fh = await open(LOG_FILE, "r");
    const len = info.size - start;
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start);
    let text = buf.toString("utf8");
    // If we started mid-file, drop the leading partial line.
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);

    let records = parseLines(text);
    if (opts.level) records = records.filter((r) => r.level === opts.level);
    if (opts.sinceIso) records = records.filter((r) => r.ts >= opts.sinceIso!);
    // Newest first, capped to `limit`.
    return records.slice(-limit).reverse();
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}

export { LOG_FILE as SERVER_LOG_FILE };
