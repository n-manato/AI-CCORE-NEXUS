import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders } from "@/lib/gateway";
import { genesisFile } from "@/lib/genesis";

export const dynamic = "force-dynamic";

const PATH = "/v1/3d/characters/{id}/results";

// Content types the artifacts use. VRM is glTF-binary underneath.
const TYPES: Record<string, string> = {
  ".vrm": "model/gltf-binary",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
  ".png": "image/png",
};

// GET /v1/3d/characters/{job_id}/results/{filename} - download one artifact
// (character.vrm, character.glb, validation.json, job.json).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const gate = await gateRequest(req, PATH, undefined, { skipModelLease: true });
  if (!gate.ok) return gate.response;
  try {
    const { id, filename } = await params;
    // Genesis3D also guards this, but reject traversal before leaving the gateway.
    if (filename.includes("/") || filename.includes("..")) {
      return gatewayError("bad_request", { detail: "invalid filename" });
    }
    const file = await genesisFile(id, filename);
    if (!file) return gatewayError("not_found", { detail: "artifact not found" });

    const dot = filename.lastIndexOf(".");
    const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        ...corsHeaders(req.headers.get("origin")),
        "Content-Type": TYPES[ext] ?? file.contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
