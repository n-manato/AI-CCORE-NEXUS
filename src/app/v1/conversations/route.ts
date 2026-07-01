import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, gatewayError, corsHeaders } from "@/lib/gateway";
import { createConversation } from "@/lib/context/store";

export const dynamic = "force-dynamic";

const Body = z
  .object({ title: z.string().max(200).optional(), model: z.string().max(100).optional() })
  .partial();

// POST /v1/conversations — create a server-managed conversation. Unlike
// /v1/chat/completions (stateless passthrough), conversations created here are
// stored and context-managed: the server keeps full history, summarizes old
// turns, and only sends a budgeted slice to the model. See src/lib/context.
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return gatewayError("bad_request");

  const conv = await createConversation({
    userId: auth.auth.userId,
    title: parsed.data.title,
    model: parsed.data.model,
  });
  return NextResponse.json(
    { id: conv.id, title: conv.title, model: conv.model, created_at: conv.createdAt },
    { status: 201, headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
