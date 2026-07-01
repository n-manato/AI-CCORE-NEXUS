import "server-only";
import { prisma } from "@/lib/db";
import type { AdminAction } from "@/lib/constants";

export interface AuditEntry {
  adminId: string;
  action: AdminAction;
  targetUserId?: string | null;
  beforeValue?: string | null;
  afterValue?: string | null;
  ipAddress?: string | null;
}

// Writes an admin audit log entry.
// IMPORTANT: callers must never pass full API keys, passwords, prompts, or file
// contents into beforeValue/afterValue. Pass only metadata (ids, masked values,
// status changes).
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminId: entry.adminId,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      beforeValue: entry.beforeValue ?? null,
      afterValue: entry.afterValue ?? null,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

// Extracts a best-effort client IP from request headers.
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip");
}
