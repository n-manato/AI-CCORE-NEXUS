import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders } from "@/lib/gateway";
import { genesisResults } from "@/lib/genesis";

export const dynamic = "force-dynamic";

const PATH = "/v1/3d/characters/{id}/results";

// GET /v1/3d/characters/{job_id}/results - candidate list, scores and artifact names.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(req, PATH, undefined, { skipModelLease: true });
  if (!gate.ok) return gate.response;
  try {
    const { id } = await params;
    const results = await genesisResults(id);
    if (!results) return gatewayError("not_found", { detail: "job not found" });
    return NextResponse.json(results, { headers: corsHeaders(req.headers.get("origin")) });
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
