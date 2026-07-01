import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";

// Admin: clear the queue by canceling all waiting jobs.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const result = await prisma.job.updateMany({
    where: { status: "Waiting" },
    data: { status: "Canceled", completedAt: new Date() },
  });

  await writeAudit({
    adminId: guard.user.id,
    action: "QUEUE_CLEAR",
    afterValue: `canceled ${result.count} waiting job(s)`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true, canceled: result.count });
}
