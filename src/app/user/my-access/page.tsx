import { PageHeader } from "@/components/layout/page-header";
import { MyKeyCard } from "@/components/users/my-key-card";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { CopyButton } from "@/components/ui/copy-button";
import { requireUser } from "@/lib/auth";
import { getActiveKey } from "@/lib/keys";
import { getMyAccessView } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Access - Local AI Gateway" };

export default async function MyAccessPage() {
  const user = await requireUser();
  const [key, rows] = await Promise.all([getActiveKey(user.id), getMyAccessView(user.id)]);

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="My Access"
        description="Your API key and the live status of every API. URLs appear only for APIs you are allowed to use."
      />

      <div className="mb-5">
        <MyKeyCard
          userId={user.id}
          prefix={key?.keyPrefix ?? null}
          last4={key?.last4 ?? null}
          status={key?.status ?? null}
        />
      </div>

      <TableWrap>
        <THead>
          <TR>
            <TH>API</TH>
            <TH>Access</TH>
            <TH>API Status</TH>
            <TH>GPU Status</TH>
            <TH>Result</TH>
            <TH>Current Model</TH>
            <TH>URL</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.apiName}>
              <TD>
                <div className="font-medium text-ink">{r.apiName}</div>
                <div className="text-xs text-muted">{r.category}</div>
              </TD>
              <TD>
                <StatusBadge status={r.access} />
              </TD>
              <TD>
                <StatusBadge status={r.apiStatus} />
              </TD>
              <TD>
                <StatusBadge status={r.gpuStatus} />
              </TD>
              <TD>
                <StatusBadge status={r.result} />
              </TD>
              <TD className="text-ink-dim">{r.currentModel ?? "-"}</TD>
              <TD>
                {r.showUrl && r.url ? (
                  <div className="flex items-center gap-1.5">
                    <code className="max-w-[260px] truncate rounded bg-bg-base px-1.5 py-0.5 font-mono text-xs text-ink-dim">
                      {r.url}
                    </code>
                    <CopyButton text={r.url} label="" />
                  </div>
                ) : (
                  <span className="text-xs text-muted">Not available</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>

      <p className="mt-3 text-xs text-muted">
        If an API you can access is stopped, its URL is still shown but marked Temporarily
        unavailable. When the GPU is Busy, requests may be slower than usual.
      </p>
    </>
  );
}
