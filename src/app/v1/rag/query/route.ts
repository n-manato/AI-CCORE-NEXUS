import { NextResponse } from "next/server";
import { z } from "zod";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";

export const dynamic = "force-dynamic";

const Body = z.object({ query: z.string().min(1), top_k: z.number().int().positive().optional() });
const PATH = "/v1/rag/query";

// POST /v1/rag/query - retrieval-augmented document QA (mock skeleton).
export async function POST(req: Request) {
  const gate = await gateRequest(req, PATH);
  if (!gate.ok) return gate.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
    return gatewayError("bad_request");
  }

  await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false });
  return NextResponse.json(
    {
      answer:
        "This is a mock RAG answer. Connect a real retriever + LLM backend to enable document QA.",
      sources: [],
    },
    { headers: corsHeaders(req.headers.get("origin")) },
  );
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
