import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticate, corsHeaders, gatewayError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// POST /v1/jobs/{job_id}/cancel - cancel a job. Owner or admin only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return gatewayError("not_found");
  if (auth.auth.userRole !== "admin" && job.userId !== auth.auth.userId) {
    return gatewayError("access_denied");
  }
  if (job.status === "Completed" || job.status === "Canceled") {
    return gatewayError("conflict");
  }

  await prisma.job.update({
    where: { id },
    data: { status: "Canceled", completedAt: new Date() },
  });

  return NextResponse.json({ id, status: "Canceled" }, { headers: corsHeaders(req.headers.get("origin")) });
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
