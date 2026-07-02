import { NextResponse } from "next/server";
import { z } from "zod";
import { gateRequest, gatewayError, corsHeaders, recordUsage, isTimeoutError } from "@/lib/gateway";
import { motionHealth, motionGenerate } from "@/lib/motion";

export const dynamic = "force-dynamic";

const Body = z.object({
  prompt: z.string().min(1).optional(),
  emotion: z.string().min(1).optional(),
  duration: z.number().positive().max(5).optional(),
  seed: z.number().int().optional(),
});

const PATH = "/v1/motion/generate";

// POST /v1/motion/generate - English text -> MMD body motion (.vmd). Proxies to the
// HY-Motion service and returns the .vmd bytes (the same way TTS returns audio).
export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH, "hy-motion-1");
  if (!gate.ok) return gate.response;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success || (!parsed.data.prompt && !parsed.data.emotion)) {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: "hy-motion-1", path: PATH, code: "bad_request" });
      return gatewayError("bad_request", { detail: "prompt or emotion is required" });
    }

    try {
      const health = await motionHealth();
      if (!health?.capabilities.motion) {
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: "hy-motion-1", path: PATH, code: "unavailable" });
        return gatewayError("unavailable", { detail: "motion service unreachable" });
      }
      const format = new URL(req.url).searchParams.get("format") === "smpl" ? "smpl" : "vmd";
      const out = await motionGenerate(parsed.data, format);
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: "hy-motion-1", path: PATH });
      if (format === "smpl") {
        return NextResponse.json(out, { headers: corsHeaders(req.headers.get("origin")) });
      }
      return new NextResponse(new Uint8Array(out as Buffer), {
        status: 200,
        headers: {
          ...corsHeaders(req.headers.get("origin")),
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="motion.vmd"',
        },
      });
    } catch (e) {
      const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: "hy-motion-1", path: PATH, code: key });
      return gatewayError(key);
    }
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
