import { NextResponse } from "next/server";
import { z } from "zod";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { activeBackend } from "@/lib/backends";
import { sidecarHealth, sidecarTts } from "@/lib/sidecar";
import { ttsHealth, ttsSynthesize, TTS_MODEL_ID } from "@/lib/tts";
import { startTtsService } from "@/lib/tts-process";

export const dynamic = "force-dynamic";

// Media type for the audio bytes GPT-SoVITS returns, by requested format.
function audioContentType(format?: string): string {
  switch ((format ?? "wav").toLowerCase()) {
    case "ogg": return "audio/ogg";
    case "aac": return "audio/aac";
    case "mp3": return "audio/mpeg";
    default: return "audio/wav";
  }
}

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
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const gate = await gateRequest(req, PATH, parsed.success ? parsed.data.model : undefined);
  if (!gate.ok) return gate.response;
  try {
    if (!parsed.success) {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
      return gatewayError("bad_request");
    }

    const ok = () => recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: parsed.data.model });
    const audio = (bytes: Buffer, contentType = "audio/wav", ext = "wav") =>
      new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          ...corsHeaders(req.headers.get("origin")),
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="speech.${ext}"`,
        },
      });

    try {
      // GPT-SoVITS voice stack (voice_service :9881 -> GPT-SoVITS :9880 -> RVC).
      // This is the real installed TTS; route to it whenever it's selected/healthy.
      if (parsed.data.model === TTS_MODEL_ID || (await ttsHealth())) {
        await startTtsService(); // On Demand: bring the stack up if it isn't already
        const fmt = parsed.data.format;
        const out = await ttsSynthesize(parsed.data.input, { format: fmt });
        await ok();
        return audio(out, audioContentType(fmt), (fmt ?? "wav").toLowerCase());
      }
      const health = await sidecarHealth();
      if (health?.capabilities.tts) {
        const out = await sidecarTts(parsed.data.input, parsed.data.voice);
        await ok();
        return audio(out);
      }
      const speech = await activeBackend.textToSpeech(parsed.data); // mock silent WAV
      await ok();
      return audio(Buffer.from(speech.base64, "base64"));
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
