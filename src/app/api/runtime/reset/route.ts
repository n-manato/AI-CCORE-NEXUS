import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { getSetting } from "@/lib/system";
import { writeAudit, clientIp } from "@/lib/audit";
import { SETTING_KEYS } from "@/lib/constants";

interface DefaultCfg {
  modelId: string;
  startupPolicy: string;
  runtimeType: string;
  modelSizeClass: string;
  enabled: boolean;
  maxConcurrent: number;
}

// Admin: restore the recommended default runtime configuration (seed defaults).
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const raw = await getSetting(SETTING_KEYS.runtimeDefaults);
  if (!raw) return NextResponse.json({ error: "No defaults stored" }, { status: 404 });

  let defaults: DefaultCfg[];
  try {
    defaults = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corrupt defaults" }, { status: 500 });
  }

  await prisma.$transaction(
    defaults.map((d) =>
      prisma.modelRuntimeConfig.update({
        where: { modelId: d.modelId },
        data: {
          startupPolicy: d.startupPolicy === "Job Queue" ? "On Demand" : d.startupPolicy,
          runtimeType: d.runtimeType,
          modelSizeClass: d.modelSizeClass,
          enabled: d.enabled,
          maxConcurrent: d.maxConcurrent,
        },
      }),
    ),
  );

  await writeAudit({
    adminId: guard.user.id,
    action: "RUNTIME_RESET",
    afterValue: "Runtime config reset to recommended defaults",
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
