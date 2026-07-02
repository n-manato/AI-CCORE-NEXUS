import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { appIdToTag, ollamaHasTag, ollamaVision, toAppId } from "@/lib/ollama";

export const dynamic = "force-dynamic";

const PATH = "/v1/vision/chat";
const DEFAULT_VISION = "qwen2.5vl:7b";

// POST /v1/vision/chat - image question answering (Ollama VLM). The image is not stored.
export async function POST(req: Request) {
  const t0 = Date.now();
  const form = await req.formData().catch(() => null);
  const modelField = (form?.get("model") as string) || "qwen2.5-vl-7b";
  const gate = await gateRequest(req, PATH, toAppId(modelField));
  if (!gate.ok) return gate.response;
  try {
    const file = form?.get("file");
    const prompt = (form?.get("prompt") as string) || "Describe this image.";
    if (!file || typeof file === "string") {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
      return gatewayError("bad_request");
    }

    const tag = appIdToTag(modelField) ?? (modelField.includes(":") ? modelField : DEFAULT_VISION);
    try {
      if (await ollamaHasTag(tag)) {
        const buf = Buffer.from(await (file as File).arrayBuffer());
        const text = await ollamaVision(tag, prompt, buf.toString("base64"));
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: modelField });
        return NextResponse.json({ model: tag, text }, { headers: corsHeaders(req.headers.get("origin")) });
      }
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, model: modelField });
      return NextResponse.json(
        { object: "mock", api: "Vision QA", message: "No vision model is pulled in Ollama yet. Pull qwen2.5vl and Sync." },
        { headers: corsHeaders(req.headers.get("origin")) },
      );
    } catch {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: modelField });
      return gatewayError("backend_error");
    }
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
