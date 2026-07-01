import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { setSetting, getMaintenanceState } from "@/lib/system";
import { writeAudit, clientIp } from "@/lib/audit";
import { SETTING_KEYS } from "@/lib/constants";

const Body = z.object({
  state: z.enum(["Off", "Scheduled", "On"]),
  jobPolicy: z.enum(["continue", "cancel", "pause"]).optional(),
});

// Admin: set maintenance mode. When turning On, applies the chosen job policy:
//  - continue: running jobs keep running, waiting jobs are paused
//  - cancel: cancel running jobs, pause waiting jobs
//  - pause: pause the queue only (no new work starts)
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { state, jobPolicy } = parsed.data;

  const before = await getMaintenanceState();
  await setSetting(SETTING_KEYS.maintenanceMode, state);
  if (jobPolicy) await setSetting(SETTING_KEYS.maintenanceJobPolicy, jobPolicy);

  if (state === "On" && jobPolicy === "cancel") {
    await prisma.job.updateMany({
      where: { status: "Running" },
      data: { status: "Canceled", completedAt: new Date() },
    });
  }

  await writeAudit({
    adminId: guard.user.id,
    action: "MAINTENANCE_MODE",
    beforeValue: `state=${before}`,
    afterValue: `state=${state}${jobPolicy ? `; jobPolicy=${jobPolicy}` : ""}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true, state });
}
