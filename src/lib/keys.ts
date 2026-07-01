import "server-only";
import { prisma } from "@/lib/db";

// Returns the most recent active key for a user, if any.
export async function getActiveKey(userId: string) {
  return prisma.apiKey.findFirst({
    where: { userId, status: "active", revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
}
