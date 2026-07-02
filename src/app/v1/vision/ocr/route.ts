import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { sidecarHealth, sidecarOcr } from "@/lib/sidecar";

export const dynamic = "force-dynamic";
const PATH = "/v1/vision/ocr";

// POST /v1/vision/ocr - extract text from an image (sidecar RapidOCR). Not stored.
export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH);
  if (!gate.ok) return gate.response;
  try {
    const fd = await req.formData().catch(() => null);
    const file = fd?.get("file");
    if (!file || typeof file === "string") {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: "paddleocr" });
      return gatewayError("bad_request");
    }
    const health = await sidecarHealth();
    if (health?.capabilities.ocr) {
      try {
        const buf = Buffer.from(await (file as File).arrayBuffer());
        const result = await sidecarOcr(buf);
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: "paddleocr" });
        return NextResponse.json(result, { headers: corsHeaders(req.headers.get("origin")) });
      } catch {
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: "paddleocr" });
        return gatewayError("backend_error");
      }
    }
    await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, model: "paddleocr" });
    return NextResponse.json(
      { object: "mock", api: "OCR", message: "OCR backend not running yet." },
      { headers: corsHeaders(req.headers.get("origin")) },
    );
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
