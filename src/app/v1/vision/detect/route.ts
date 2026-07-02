import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { sidecarHealth, sidecarDetect } from "@/lib/sidecar";

export const dynamic = "force-dynamic";
const PATH = "/v1/vision/detect";

// POST /v1/vision/detect - object detection (sidecar YOLO). Image not stored.
export async function POST(req: Request) {
  const t0 = Date.now();
  const fd = await req.formData().catch(() => null);
  const model = (fd?.get("model") as string) || "yolo11s";
  const gate = await gateRequest(req, PATH, model);
  if (!gate.ok) return gate.response;
  try {
    const file = fd?.get("file");
    if (!file || typeof file === "string") {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model });
      return gatewayError("bad_request");
    }
    const health = await sidecarHealth();
    if (health?.capabilities.detect) {
      try {
        const buf = Buffer.from(await (file as File).arrayBuffer());
        const result = await sidecarDetect(buf, model);
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model });
        return NextResponse.json(result, { headers: corsHeaders(req.headers.get("origin")) });
      } catch {
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model });
        return gatewayError("backend_error");
      }
    }
    await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, model });
    return NextResponse.json(
      { object: "mock", api: "Object Detection", message: "Detection backend not running yet." },
      { headers: corsHeaders(req.headers.get("origin")) },
    );
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
