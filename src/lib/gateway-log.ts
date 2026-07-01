import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Durable, file-based error log for the gateway.
//
// The app is run with `next dev` inside a terminal, so request errors only ever
// land in that terminal's scrollback and are lost on restart — which made a real
// 502 incident impossible to diagnose after the fact. This sink appends one JSON
// line per failed gateway request to logs/gateway-errors.log (override the dir
// with GATEWAY_LOG_DIR) so the real cause is always recoverable, independent of
// how the process was launched. It is best-effort: it never throws into, nor
// blocks, the request path.

const LOG_DIR = process.env.GATEWAY_LOG_DIR ?? path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "gateway-errors.log");
let dirReady = false;

export interface GatewayErrorEntry {
  path: string;
  apiName?: string;
  model?: string;
  /** Gateway error code returned to the client (e.g. context_length_exceeded). */
  code: string;
  /** HTTP status the gateway returned to the client. */
  status: number;
  /** Upstream (Ollama) HTTP status, when the failure came from the backend. */
  upstreamStatus?: number;
  /** Upstream / exception message, trimmed. */
  message?: string;
  stream?: boolean;
}

export function logGatewayError(entry: GatewayErrorEntry): void {
  const record = { ts: new Date().toISOString(), ...entry };
  const line = JSON.stringify(record) + "\n";

  // Echo to stdout too, so it's visible in the dev terminal in real time.
  try {
    console.error("[gateway-error]", line.trimEnd());
  } catch {
    /* ignore */
  }

  // Fire-and-forget append; logging must never break or slow a response.
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
