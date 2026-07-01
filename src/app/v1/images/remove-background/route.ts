import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { sidecarHealth, sidecarRemoveBg } from "@/lib/sidecar";

export const dynamic = "force-dynamic";
const PATH = "/v1/images/remove-background";

// POST /v1/images/remove-background - remove an image background. multipart: file.
// Served by the Python sidecar (rembg). Returns a PNG with transparency.
export async function POST(req: Request) {
  const gate = await gateRequest(req, PATH);
  if (!gate.ok) return gate.response;

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!file || typeof file === "string") {
    await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
    return gatewayError("bad_request");
  }

  const health = await sidecarHealth();
  if (health?.capabilities.removebg) {
    try {
      const buf = Buffer.from(await (file as File).arrayBuffer());
      const out = await sidecarRemoveBg(buf);
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false });
      return new NextResponse(new Uint8Array(out), {
        status: 200,
        headers: {
          ...corsHeaders(req.headers.get("origin")),
          "Content-Type": "image/png",
          "Content-Disposition": 'inline; filename="output.png"',
        },
      });
    } catch {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
      return gatewayError("backend_error");
    }
  }

  await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false });
  return NextResponse.json(
    { object: "mock", api: "Background Removal", message: "Background-removal backend (rembg) not running yet." },
    { headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
