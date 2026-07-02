import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";

export const dynamic = "force-dynamic";

const Body = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  size: z.string().optional(),
  n: z.number().int().min(1).max(4).optional(),
});
const PATH = "/v1/images/generations";

// POST /v1/images/generations - heavy image generation runs as a Job. Returns a
// job id the caller can poll via GET /v1/jobs/{id}. (Backend is mock; the API is
// "Not Installed" by default, so this returns 404 until enabled.)
export async function POST(req: Request) {
  const gate = await gateRequest(req, PATH);
  if (!gate.ok) return gate.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
    return gatewayError("bad_request");
  }

  // Heavy job priority (5). Prompt content is never stored.
  const job = await prisma.job.create({
    data: { userId: gate.auth.userId, apiName: gate.apiName, status: "Waiting", priority: 5, progress: 0 },
  });
  await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, model: parsed.data.model });

  return NextResponse.json(
    { job_id: job.id, status: job.status },
    { status: 202, headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
