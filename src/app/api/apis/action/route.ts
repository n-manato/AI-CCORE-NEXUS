import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({
  apiName: z.string().min(1),
  action: z.enum(["disable", "enable"]),
});

// Admin override for an API. Unlike a "stop", this is a real, sticky flag that
// the request gate enforces (Disabled -> rejected) and that Sync respects (a
// disabled API stays Disabled even when its backend is healthy). Start/stop of
// the underlying backend is managed by the backend itself (Ollama/sidecar), not
// faked here.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { apiName, action } = parsed.data;

  const api = await prisma.apiStatus.findUnique({ where: { apiName } });
  if (!api) return NextResponse.json({ error: "API not found" }, { status: 404 });

  const disabled = action === "disable";
  await prisma.apiStatus.update({
    where: { apiName },
    data: {
      adminDisabled: disabled,
      // When disabling, reflect immediately; when enabling, leave status for the
      // next sync/refresh to recompute from the live backend.
      ...(disabled ? { status: "Disabled" } : {}),
      lastChecked: new Date(),
    },
  });

  await writeAudit({
    adminId: guard.user.id,
    action: disabled ? "API_DISABLE" : "API_ENABLE",
    beforeValue: `${apiName}: ${api.status}`,
    afterValue: `${apiName}: adminDisabled=${disabled}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true, adminDisabled: disabled });
}
