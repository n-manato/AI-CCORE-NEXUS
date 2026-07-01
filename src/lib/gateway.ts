import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashKey } from "@/lib/crypto";
import { logServerEvent } from "@/lib/server-log";
import {
  ENDPOINT_CATEGORY,
  SETTING_KEYS,
  API_MODEL,
  type Category,
} from "@/lib/constants";

// ---- Structured error responses (see spec "Error handling") ----

interface ErrorDef {
  status: number;
  type: string;
  message: string;
}

export const ERRORS = {
  bad_request: { status: 400, type: "invalid_request_error", message: "Invalid request format." },
  invalid_api_key: { status: 401, type: "authentication_error", message: "Invalid API key." },
  access_denied: { status: 403, type: "permission_error", message: "You do not have access to this API." },
  not_found: { status: 404, type: "not_found_error", message: "The requested resource was not found." },
  timeout: { status: 408, type: "timeout_error", message: "The request timed out." },
  conflict: { status: 409, type: "conflict_error", message: "The request conflicts with the current system state." },
  rate_limited: { status: 429, type: "rate_limit_error", message: "Too many requests. Please try again later." },
  internal: { status: 500, type: "server_error", message: "Internal server error." },
  context_length_exceeded: { status: 400, type: "invalid_request_error", message: "The request exceeds the model's maximum context length." },
  chat_template_error: { status: 400, type: "invalid_request_error", message: "The conversation could not be rendered by the model's chat template." },
  backend_error: { status: 502, type: "backend_error", message: "The backend service returned an error." },
  unavailable: { status: 503, type: "service_unavailable", message: "This API is temporarily unavailable." },
  backend_timeout: { status: 504, type: "backend_timeout", message: "The backend service timed out." },
  gpu_full: { status: 507, type: "gpu_full", message: "The GPU is very busy. Please try again later." },
  maintenance: { status: 503, type: "maintenance", message: "The system is currently under maintenance. Please try again later." },
} satisfies Record<string, ErrorDef>;

export type ErrorKey = keyof typeof ERRORS;

export function errorStatus(key: ErrorKey): number {
  return ERRORS[key].status;
}

export function gatewayError(key: ErrorKey, extra?: Record<string, unknown>) {
  const def = ERRORS[key];
  return NextResponse.json(
    { error: { message: def.message, type: def.type, code: key, ...extra } },
    { status: def.status, headers: corsHeaders() },
  );
}

// Pulls a human-readable message out of an upstream (Ollama) error body. Ollama's
// OpenAI-compatible endpoint returns {"error":{"message,code,...}}, its native
// API returns {"error":"..."}; fall back to the raw text (truncated).
export function extractUpstreamMessage(body?: string | null): string | undefined {
  if (!body) return undefined;
  try {
    const j = JSON.parse(body) as { error?: unknown };
    const e = j.error;
    if (typeof e === "string") return e;
    if (e && typeof (e as { message?: unknown }).message === "string") {
      return (e as { message: string }).message;
    }
  } catch {
    /* not JSON */
  }
  const t = body.trim();
  return t ? t.slice(0, 500) : undefined;
}

// True for a fetch aborted by AbortSignal.timeout() (DOMException "TimeoutError")
// or a classic AbortError — used to map an upstream stall to 504, not 502.
export function isTimeoutError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

// Classifies an upstream backend failure into a precise gateway error instead of
// collapsing everything into a 502. The chat route used to return backend_error
// for ALL non-2xx Ollama responses, which hid the real cause (context overflow,
// strict chat-template rejection, GPU pressure, timeouts) behind an opaque 502.
export function classifyBackendError(
  status: number | undefined,
  body?: string | null,
): { key: ErrorKey; detail?: string } {
  const detail = extractUpstreamMessage(body);
  const hay = `${detail ?? ""} ${body ?? ""}`.toLowerCase();

  if (/exceeds the available context|context (length|size|window)|maximum context|too many tokens/.test(hay)) {
    return { key: "context_length_exceeded", detail };
  }
  if (/jinja|chat template|roles must alternate|conversation roles|template error/.test(hay)) {
    return { key: "chat_template_error", detail };
  }
  if (/out of memory|cudamalloc|cuda error|vram|no space|insufficient memory|failed to allocate/.test(hay)) {
    return { key: "gpu_full", detail };
  }
  if (status === 408 || status === 504) return { key: "backend_timeout", detail };
  if (status === 503) return { key: "unavailable", detail };
  if (status === 400 || status === 422) return { key: "bad_request", detail };
  return { key: "backend_error", detail };
}

// ---- CORS ----

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    Vary: "Origin",
  };
}

// ---- Naive in-memory throttle for repeated invalid API-key attempts ----
// Resets on server restart. For production, back this with Redis.

const invalidAttempts = new Map<string, { count: number; until: number }>();
const MAX_INVALID = 5;
const BLOCK_MS = 5 * 60 * 1000;

function isBlocked(ip: string): boolean {
  const rec = invalidAttempts.get(ip);
  if (!rec) return false;
  if (rec.count >= MAX_INVALID && rec.until > Date.now()) return true;
  if (rec.until <= Date.now()) invalidAttempts.delete(ip);
  return false;
}

function noteInvalid(ip: string): void {
  const rec = invalidAttempts.get(ip) ?? { count: 0, until: Date.now() + BLOCK_MS };
  rec.count += 1;
  rec.until = Date.now() + BLOCK_MS;
  invalidAttempts.set(ip, rec);
}

function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "local";
}

// ---- In-process concurrency limiter (enforces Max Concurrent per model) ----
// In-memory => per server instance. A safety timer auto-releases a slot after
// 3 minutes so a route that forgets to release can never wedge an API.

const slots = new Map<string, number>();

function acquireSlot(modelId: string, limit: number): (() => void) | null {
  const cur = slots.get(modelId) ?? 0;
  if (cur >= limit) return null;
  slots.set(modelId, cur + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    slots.set(modelId, Math.max(0, (slots.get(modelId) ?? 1) - 1));
  };
  const timer = setTimeout(release, 180_000);
  return release;
}

// ---- Maps each endpoint path to its API name + governing category ----

export const ENDPOINT_API: Record<string, { apiName: string; category: Category }> = {
  "/v1/chat/completions": { apiName: "LLM Chat", category: "LLM" },
  "/v1/rag/query": { apiName: "LLM RAG", category: "LLM" },
  "/v1/audio/speech": { apiName: "TTS", category: "TTS" },
  "/v1/audio/transcriptions": { apiName: "STT", category: "STT" },
  "/v1/audio/enhance": { apiName: "Speech Enhancement", category: "STT" },
  "/v1/audio/voice-conversion": { apiName: "Voice Conversion", category: "STT" },
  "/v1/vision/chat": { apiName: "Vision QA", category: "Vision" },
  "/v1/vision/ocr": { apiName: "OCR", category: "Vision" },
  "/v1/vision/detect": { apiName: "Object Detection", category: "Vision" },
  "/v1/vision/segment": { apiName: "Segmentation", category: "Vision" },
  "/v1/vision/pose": { apiName: "Pose Estimation", category: "Vision" },
  "/v1/vision/depth": { apiName: "Depth Estimation", category: "Vision" },
  "/v1/images/generations": { apiName: "Image Generation", category: "Image" },
  "/v1/images/enhance": { apiName: "Image Enhancement", category: "Image" },
  "/v1/images/remove-background": { apiName: "Background Removal", category: "Image" },
  "/v1/video/understanding/jobs": { apiName: "Video Understanding", category: "Video" },
  "/v1/video/lip-sync/jobs": { apiName: "Lip Sync", category: "Video" },
  "/v1/motion/generate": { apiName: "Motion Generation", category: "Motion" },
  "/v1/robot-motion/commands": { apiName: "Robot Motion", category: "Motion" },
};

// ---- Authentication ----

export interface AuthedKey {
  userId: string;
  userRole: string;
  apiKeyId: string;
}

export type AuthResult =
  | { ok: true; auth: AuthedKey }
  | { ok: false; response: NextResponse };

// Validates the Authorization: Bearer <key> header against stored key hashes.
// Never logs the raw key. Throttles repeated invalid attempts by client IP.
export async function authenticate(req: Request): Promise<AuthResult> {
  const ip = clientIp(req.headers);
  if (isBlocked(ip)) {
    return { ok: false, response: gatewayError("rate_limited") };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    noteInvalid(ip);
    return { ok: false, response: gatewayError("invalid_api_key") };
  }
  const raw = match[1]!.trim();
  const keyHash = hashKey(raw);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  });

  if (!apiKey || apiKey.status !== "active" || apiKey.revokedAt) {
    noteInvalid(ip);
    return { ok: false, response: gatewayError("invalid_api_key") };
  }
  if (apiKey.user.status === "disabled") {
    return { ok: false, response: gatewayError("access_denied") };
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    ok: true,
    auth: { userId: apiKey.userId, userRole: apiKey.user.role, apiKeyId: apiKey.id },
  };
}

// ---- Authorization, maintenance, status gating ----

export async function maintenanceOn(): Promise<boolean> {
  const s = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.maintenanceMode },
  });
  return s?.value === "On";
}

export async function hasCategoryAccess(userId: string, category: Category): Promise<boolean> {
  const a = await prisma.apiAccess.findUnique({
    where: { userId_category: { userId, category } },
  });
  return !!a?.enabled;
}

export function categoryForEndpoint(path: string): Category | undefined {
  return ENDPOINT_CATEGORY[path];
}

// Records a usage data point. Stores only counts/metadata, never request content.
// This is the single chokepoint every gateway route hits on both success and
// failure, so it doubles as the writer for the durable server request log
// (logs/server.log) consumed by the admin "Server Logs" page. Optional model/
// path/code/status/message enrich the log line (the LLM routes pass the
// classified backend error); other routes record a baseline line.
export async function recordUsage(params: {
  userId: string;
  apiName: string;
  category: Category;
  isError: boolean;
  latencyMs?: number;
  model?: string;
  path?: string;
  code?: string;
  status?: number;
  message?: string;
  stream?: boolean;
}): Promise<void> {
  const latencyMs = Math.max(0, Math.round(params.latencyMs ?? 0));
  // Best-effort: usage logging must NEVER break or fail a request. (A transient
  // DB error — e.g. the schema/client mismatch right after a migration, before
  // the dev server reloads the Prisma client — must not propagate into the
  // response path, especially for streaming where it would surface as an
  // unhandled rejection and tear down the in-flight stream.)
  try {
    await prisma.usageLog.create({
      data: {
        userId: params.userId,
        apiName: params.apiName,
        category: params.category,
        requestCount: 1,
        errorCount: params.isError ? 1 : 0,
        latencyMs,
        errorCode: params.isError ? params.code ?? null : null,
      },
    });
  } catch (e) {
    console.error("[recordUsage] failed to persist usage log:", (e as Error)?.message);
  }

  // Mirror to the durable, tailable server log (best-effort, never blocks).
  logServerEvent({
    level: params.isError ? "error" : "info",
    path: params.path ?? "",
    apiName: params.apiName,
    category: params.category,
    userId: params.userId,
    model: params.model,
    status: params.status,
    code: params.isError ? params.code : undefined,
    latencyMs,
    message: params.message,
    stream: params.stream,
  });
}

// Runs the shared gate for a gateway request: auth -> maintenance -> access ->
// API status. Returns the authed identity plus resolved api metadata, or an
// error response to return directly.
export async function gateRequest(
  req: Request,
  path: string,
  requestedModelId?: string,
): Promise<
  | { ok: true; auth: AuthedKey; apiName: string; category: Category; release: () => void }
  | { ok: false; response: NextResponse }
> {
  const mapping = ENDPOINT_API[path];
  if (!mapping) return { ok: false, response: gatewayError("not_found") };

  const authRes = await authenticate(req);
  if (!authRes.ok) return authRes;
  const { auth } = authRes;

  // Admins may test APIs during maintenance; normal users are blocked.
  if (auth.userRole !== "admin" && (await maintenanceOn())) {
    return { ok: false, response: gatewayError("maintenance") };
  }

  if (!(await hasCategoryAccess(auth.userId, mapping.category))) {
    return { ok: false, response: gatewayError("access_denied") };
  }

  const status = await prisma.apiStatus.findUnique({ where: { apiName: mapping.apiName } });
  if (!status || status.status === "Not Installed") {
    return { ok: false, response: gatewayError("not_found", { detail: "API not installed" }) };
  }
  if (status.status !== "Online") {
    return { ok: false, response: gatewayError("unavailable") };
  }

  // Runtime enforcement against the SPECIFIC model the caller asked for (falling
  // back to the API's default governing model when the route can't supply one):
  // a disabled model is blocked, and Max Concurrent caps in-flight requests.
  const modelId = requestedModelId ?? API_MODEL[mapping.apiName];
  let release = () => {};
  if (modelId) {
    const cfg = await prisma.modelRuntimeConfig.findUnique({ where: { modelId } });
    if (cfg && !cfg.enabled) {
      return { ok: false, response: gatewayError("unavailable", { detail: "model disabled by admin" }) };
    }
    const rel = acquireSlot(modelId, Math.max(1, cfg?.maxConcurrent ?? 1));
    if (!rel) {
      return { ok: false, response: gatewayError("rate_limited", { detail: "max concurrency reached" }) };
    }
    release = rel;
  }

  return { ok: true, auth, apiName: mapping.apiName, category: mapping.category, release };
}
