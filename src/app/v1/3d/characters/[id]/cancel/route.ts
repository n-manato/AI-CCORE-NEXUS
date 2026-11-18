import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders } from "@/lib/gateway";
import { genesisCancel } from "@/lib/genesis";

export const dynamic = "force-dynamic";

const PATH = "/v1/3d/characters/{id}/cancel";

// POST /v1/3d/characters/{job_id}/cancel
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(req, PATH, undefined, { skipModelLease: true });
  if (!gate.ok) return gate.response;
  try {
    const { id } = await params;
    const ok = await genesisCancel(id);
    if (!ok) return gatewayError("not_found", { detail: "job not found or already finished" });
    return NextResponse.json({ job_id: id, canceled: true },
      { headers: corsHeaders(req.headers.get("origin")) });
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
