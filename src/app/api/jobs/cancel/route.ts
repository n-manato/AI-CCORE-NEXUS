import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({ jobId: z.string().min(1) });

// Admin: cancel a single job.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { jobId } = parsed.data;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status === "Completed" || job.status === "Canceled") {
    return NextResponse.json({ error: "Job already finished." }, { status: 409 });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "Canceled", completedAt: new Date() },
  });

  await writeAudit({
    adminId: guard.user.id,
    targetUserId: job.userId,
    action: "JOB_CANCEL",
    beforeValue: `${job.apiName}: ${job.status}`,
    afterValue: `${job.apiName}: Canceled`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
