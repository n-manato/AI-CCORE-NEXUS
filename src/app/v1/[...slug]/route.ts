import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  gateRequest,
  gatewayError,
  corsHeaders,
  recordUsage,
  ENDPOINT_API,
} from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Catch-all for the declared /v1 endpoints that do not yet have a dedicated
// handler. Endpoints with their own route file (models, chat/completions,
// audio/speech, jobs, ...) take precedence over this. Everything here runs the
// same gate (auth -> maintenance -> access -> API status) and returns a mock
// skeleton response so access control behaves consistently across the surface.
//
// Job-mode APIs create a real Job row and return a job id; sync/real-time APIs
// return a mock acknowledgement. Request bodies/files are never stored.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = `/v1/${slug.join("/")}`;

  if (!(path in ENDPOINT_API)) {
    return gatewayError("not_found");
  }

  const gate = await gateRequest(req, path);
  if (!gate.ok) return gate.response;

  const api = await prisma.apiStatus.findUnique({ where: { apiName: gate.apiName } });
  await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false });

  if (api?.mode === "Job") {
    const job = await prisma.job.create({
      data: { userId: gate.auth.userId, apiName: gate.apiName, status: "Waiting", priority: 5, progress: 0 },
    });
    return NextResponse.json(
      { job_id: job.id, status: job.status, api: gate.apiName },
      { status: 202, headers: corsHeaders(req.headers.get("origin")) },
    );
  }

  return NextResponse.json(
    {
      object: "mock",
      api: gate.apiName,
      message: `Mock skeleton response for ${path}. Connect a real backend to enable this endpoint.`,
    },
    { headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
