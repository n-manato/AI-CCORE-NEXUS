import { open, stat } from "node:fs/promises";
import { getCurrentUser } from "@/lib/auth";
import { SERVER_LOG_FILE } from "@/lib/server-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/server-logs/stream — Server-Sent Events live tail of
// logs/server.log. The admin Server Logs page renders the recent backlog
// server-side; this endpoint pushes ONLY lines appended after the connection
// opens (each as one `data:` event carrying the raw JSON record). Admin only.
//
// File watching is done by polling the file size every second (robust across
// platforms / bind mounts where fs.watch is unreliable) and reading just the
// appended byte range. A 15s keep-alive comment prevents idle proxies from
// cutting the connection. Everything is torn down on client disconnect.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new Response("Forbidden", { status: 403 });

  const enc = new TextEncoder();
  let lastSize = 0;
  try {
    lastSize = (await stat(SERVER_LOG_FILE)).size;
  } catch {
    lastSize = 0; // file not created yet
  }
  let carry = ""; // incomplete trailing line between polls
  let busy = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(enc.encode(payload));
        } catch {
          /* controller closed */
        }
      };
      send(": connected\n\n");

      const poll = setInterval(async () => {
        if (busy) return;
        busy = true;
        let fh;
        try {
          const size = (await stat(SERVER_LOG_FILE)).size;
          if (size < lastSize) {
            // Truncated/rotated: resync without re-dumping the whole file.
            lastSize = size;
            carry = "";
            return;
          }
          if (size === lastSize) return;
          fh = await open(SERVER_LOG_FILE, "r");
          const len = size - lastSize;
          const buf = Buffer.allocUnsafe(len);
          await fh.read(buf, 0, len, lastSize);
          lastSize = size;
          carry += buf.toString("utf8");
          const lines = carry.split("\n");
          carry = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (t) send(`data: ${t}\n\n`);
          }
        } catch {
          /* file missing this tick or transient read error — retry next poll */
        } finally {
          await fh?.close().catch(() => {});
          busy = false;
        }
      }, 1000);

      const ka = setInterval(() => send(": keep-alive\n\n"), 15_000);

      const cleanup = () => {
        clearInterval(poll);
        clearInterval(ka);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
