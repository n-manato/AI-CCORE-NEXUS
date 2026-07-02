import { NextResponse } from "next/server";
import { z } from "zod";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { activeBackend } from "@/lib/backends";
import { sidecarHealth, sidecarTts } from "@/lib/sidecar";

export const dynamic = "force-dynamic";

const Body = z.object({
  model: z.string().min(1),
  input: z.string().min(1),
  voice: z.string().optional(),
  format: z.string().optional(),
});

const PATH = "/v1/audio/speech";

// POST /v1/audio/speech - text to speech (sidecar Kokoro when available, else mock WAV).
export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH);
  if (!gate.ok) return gate.response;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
      return gatewayError("bad_request");
    }

    const ok = () => recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: parsed.data.model });
    const wav = (bytes: Buffer) =>
      new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          ...corsHeaders(req.headers.get("origin")),
          "Content-Type": "audio/wav",
          "Content-Disposition": 'inline; filename="speech.wav"',
        },
      });

    try {
      const health = await sidecarHealth();
      if (health?.capabilities.tts) {
        const out = await sidecarTts(parsed.data.input, parsed.data.voice);
        await ok();
        return wav(out);
      }
      const speech = await activeBackend.textToSpeech(parsed.data); // mock silent WAV
      await ok();
      return wav(Buffer.from(speech.base64, "base64"));
    } catch {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: parsed.data.model });
      return gatewayError("backend_error");
    }
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
