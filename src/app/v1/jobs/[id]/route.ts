import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticate, corsHeaders, gatewayError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// GET /v1/jobs/{job_id} - job status/result. Owner or admin only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return gatewayError("not_found");
  if (auth.auth.userRole !== "admin" && job.userId !== auth.auth.userId) {
    return gatewayError("access_denied");
  }

  return NextResponse.json(
    {
      id: job.id,
      api: job.apiName,
      status: job.status,
      progress: job.progress,
      priority: job.priority,
      result_path: job.resultPath,
      error: job.errorMessage,
      created_at: job.createdAt,
      started_at: job.startedAt,
      completed_at: job.completedAt,
    },
    { headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
