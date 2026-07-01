import { NextResponse } from "next/server";
import { authenticate, gatewayError, corsHeaders } from "@/lib/gateway";
import { prisma } from "@/lib/db";
import { getConversation, getAllMessages, getLatestSummary, countLiveTokens } from "@/lib/context/store";

export const dynamic = "force-dynamic";

// GET /v1/conversations/:id — inspect full stored history + current summary +
// live token total (the part that would be sent to the model). Owner or admin.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const conv = await getConversation(id);
  if (!conv) return gatewayError("not_found");
  if (conv.userId !== auth.auth.userId && auth.auth.userRole !== "admin") {
    return gatewayError("access_denied");
  }

  const [messages, summary, liveTokens] = await Promise.all([
    getAllMessages(id),
    getLatestSummary(id),
    countLiveTokens(id),
  ]);

  return NextResponse.json(
    {
      id: conv.id,
      title: conv.title,
      model: conv.model,
      live_tokens: liveTokens,
      summary: summary
        ? { content: summary.content, covers_up_to: summary.coversUpTo, message_count: summary.messageCount }
        : null,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        token_count: m.tokenCount,
        compacted: m.compacted,
        created_at: m.createdAt,
      })),
    },
    { headers: corsHeaders(req.headers.get("origin")) },
  );
}

// DELETE /v1/conversations/:id — remove a conversation and all its messages.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv) return gatewayError("not_found");
  if (conv.userId !== auth.auth.userId && auth.auth.userRole !== "admin") {
    return gatewayError("access_denied");
  }
  await prisma.conversation.delete({ where: { id } });
  return NextResponse.json({ deleted: true }, { headers: corsHeaders(req.headers.get("origin")) });
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
