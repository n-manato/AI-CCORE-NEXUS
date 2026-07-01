import { NextResponse } from "next/server";
import { authenticate, hasCategoryAccess, corsHeaders, gatewayError, recordUsage, isTimeoutError } from "@/lib/gateway";
import { motionPool, EMOTIONS } from "@/lib/motion";

export const dynamic = "force-dynamic";

const PATH = "/v1/motion/pool";

// GET /v1/motion/pool/{emotion} - instant pre-generated .vmd from the warm pool.
// 503 when the pool isn't warm yet, so PC-A can fall back to an idle animation.
export async function GET(req: Request, { params }: { params: Promise<{ emotion: string }> }) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  if (!(await hasCategoryAccess(auth.auth.userId, "Motion"))) {
    return gatewayError("access_denied");
  }
  const { emotion } = await params;
  if (!(EMOTIONS as readonly string[]).includes(emotion)) {
    return gatewayError("not_found", { detail: `unknown emotion '${emotion}'` });
  }
  const format = new URL(req.url).searchParams.get("format") === "smpl" ? "smpl" : "vmd";
  try {
    const out = await motionPool(emotion, format);
    if (out === null) {
      return gatewayError("unavailable", { detail: "pool not warm" });
    }
    await recordUsage({ userId: auth.auth.userId, apiName: "Motion Generation", category: "Motion", isError: false, model: "hy-motion-1", path: `${PATH}/${emotion}` });
    if (format === "smpl") {
      return NextResponse.json(out, { headers: corsHeaders(req.headers.get("origin")) });
    }
    return new NextResponse(new Uint8Array(out as Buffer), {
      status: 200,
      headers: {
        ...corsHeaders(req.headers.get("origin")),
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${emotion}.vmd"`,
      },
    });
  } catch (e) {
    const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
    await recordUsage({ userId: auth.auth.userId, apiName: "Motion Generation", category: "Motion", isError: true, path: `${PATH}/${emotion}`, code: key });
    return gatewayError(key);
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
