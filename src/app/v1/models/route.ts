import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticate, corsHeaders } from "@/lib/gateway";
import { computeDevicePlan } from "@/lib/runtime";

export const dynamic = "force-dynamic";

// GET /v1/models - lists installed models the authenticated key may select,
// filtered by the user's category access (admins see the whole catalog). The
// `id` is what you pass in the `model` field of the relevant endpoint.
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const access = await prisma.apiAccess.findMany({
    where: { userId: auth.auth.userId, enabled: true },
  });
  const allowed = new Set(access.map((a) => a.category));
  const isAdmin = auth.auth.userRole === "admin";

  const models = await prisma.modelRegistry.findMany({
    where: { installed: true },
    include: { runtimeState: true, runtimeConfig: true },
    orderBy: [{ category: "asc" }, { modelName: "asc" }],
  });

  const data = models
    .filter((m) => isAdmin || allowed.has(m.category))
    .map((m) => ({
      id: m.modelId,
      object: "model" as const,
      created: 1_700_000_000,
      owned_by: "local",
      category: m.category,
      function: m.function,
      backend: m.backend,
      device_plan: computeDevicePlan(m).plan,
      status: m.runtimeState?.currentStatus ?? "Stopped",
      startup_policy: m.runtimeConfig?.startupPolicy ?? "On Demand",
      estimated_vram_gb: { min: m.estimatedVramMinGb, max: m.estimatedVramMaxGb },
    }));

  return NextResponse.json(
    { object: "list", data },
    { headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
