import { PageHeader } from "@/components/layout/page-header";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Logs - Local AI Gateway" };

export default async function AuditLogsPage() {
  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 200,
    include: {
      admin: { select: { name: true } },
      target: { select: { name: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Admin Audit Logs"
        description="Immutable record of admin operations. API keys, passwords, and prompts are never stored here."
      />
      <TableWrap>
        <THead>
          <TR>
            <TH>Time</TH>
            <TH>Admin</TH>
            <TH>Action</TH>
            <TH>Target</TH>
            <TH>Before</TH>
            <TH>After</TH>
            <TH>IP</TH>
          </TR>
        </THead>
        <TBody>
          {logs.length === 0 ? (
            <TR>
              <TD colSpan={7} className="py-10 text-center text-muted">
                No audit entries yet.
              </TD>
            </TR>
          ) : (
            logs.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(l.timestamp.toISOString())}</TD>
                <TD className="text-ink-dim">{l.admin.name}</TD>
                <TD>
                  <Badge tone="accent" dot={false} className="font-mono text-[11px]">
                    {l.action}
                  </Badge>
                </TD>
                <TD className="text-ink-dim">{l.target?.name ?? "-"}</TD>
                <TD className="max-w-[200px] truncate text-xs text-muted" title={l.beforeValue ?? ""}>
                  {l.beforeValue ?? "-"}
                </TD>
                <TD className="max-w-[200px] truncate text-xs text-muted" title={l.afterValue ?? ""}>
                  {l.afterValue ?? "-"}
                </TD>
                <TD className="text-xs text-muted">{l.ipAddress ?? "-"}</TD>
              </TR>
            ))
          )}
        </TBody>
      </TableWrap>
    </>
  );
}
