import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders } from "@/lib/gateway";
import { genesisJob } from "@/lib/genesis";

export const dynamic = "force-dynamic";

const PATH = "/v1/3d/characters/{id}";

// GET /v1/3d/characters/{job_id} - current stage / progress / assigned GPU.
// skipModelLease: this is a metadata read, so it must not queue behind the
// model's concurrency cap or take a VRAM lease.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(req, PATH, undefined, { skipModelLease: true });
  if (!gate.ok) return gate.response;
  try {
    const { id } = await params;
    const job = await genesisJob(id);
    if (!job) return gatewayError("not_found", { detail: "job not found" });
    return NextResponse.json(job, { headers: corsHeaders(req.headers.get("origin")) });
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
