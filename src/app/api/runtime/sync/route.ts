import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { syncBackends } from "@/lib/sync";
import { writeAudit, clientIp } from "@/lib/audit";

// Admin: sync every label (API status, model installed/running, queue/error
// counts) to the REAL state of the backends (Ollama + Python sidecar).
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const result = await syncBackends();

  await writeAudit({
    adminId: guard.user.id,
    action: "RUNTIME_SYNC",
    afterValue: `ollama=${result.ollamaReachable} sidecar=${result.sidecarReachable} online=[${result.onlineApis.join(",")}] running=[${result.running.join(",")}]`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json(result);
}
