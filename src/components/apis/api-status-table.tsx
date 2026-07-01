"use client";

import { useRouter } from "next/navigation";
import { Ban, Check } from "lucide-react";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { AdminActionButton } from "@/components/ui/admin-action-button";
import { postJson, formatRelative } from "@/lib/client";

export interface ApiRow {
  apiName: string;
  category: string;
  status: string;
  currentModel: string | null;
  backend: string | null;
  mode: string;
  usesGpu: boolean;
  queueCount: number;
  runningCount: number;
  averageResponseTime: number;
  errorCount: number;
  lastChecked: string;
  description: string;
  adminDisabled: boolean;
}

export function ApiStatusTable({ apis }: { apis: ApiRow[] }) {
  const router = useRouter();

  async function act(apiName: string, action: string) {
    await postJson("/api/apis/action", { apiName, action });
    router.refresh();
  }

  return (
    <TableWrap>
      <THead>
        <TR>
          <TH>API</TH>
          <TH>Status</TH>
          <TH>Current Model</TH>
          <TH>Backend</TH>
          <TH>Mode</TH>
          <TH className="text-center">GPU</TH>
          <TH className="text-right">Queue</TH>
          <TH className="text-right">Running</TH>
          <TH className="text-right">Avg RT</TH>
          <TH className="text-right">Errors</TH>
          <TH>Last Checked</TH>
          <TH className="text-right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {apis.map((a) => (
          <TR key={a.apiName}>
            <TD>
              <div className="font-medium text-ink">{a.apiName}</div>
              <div className="max-w-[220px] truncate text-xs text-muted">{a.description}</div>
            </TD>
            <TD>
              <StatusBadge status={a.status} />
            </TD>
            <TD className="text-ink-dim">{a.currentModel ?? "-"}</TD>
            <TD className="text-ink-dim">{a.backend ?? "-"}</TD>
            <TD>
              <Badge tone="neutral" dot={false}>
                {a.mode}
              </Badge>
            </TD>
            <TD className="text-center text-ink-dim">{a.usesGpu ? "Yes" : "No"}</TD>
            <TD className="text-right tabular-nums">{a.queueCount}</TD>
            <TD className="text-right tabular-nums">{a.runningCount}</TD>
            <TD className="text-right tabular-nums">
              {a.averageResponseTime ? `${Math.round(a.averageResponseTime)}ms` : "-"}
            </TD>
            <TD className="text-right tabular-nums">
              <span className={a.errorCount > 0 ? "text-warn" : "text-ink-dim"}>{a.errorCount}</span>
            </TD>
            <TD className="whitespace-nowrap text-xs text-muted">{formatRelative(a.lastChecked)}</TD>
            <TD>
              <div className="flex justify-end gap-1.5">
                {a.adminDisabled ? (
                  <AdminActionButton
                    label="Enable"
                    icon={<Check className="h-3.5 w-3.5" />}
                    requireConfirm={false}
                    onConfirm={() => act(a.apiName, "enable")}
                  />
                ) : (
                  <AdminActionButton
                    label="Disable"
                    icon={<Ban className="h-3.5 w-3.5" />}
                    danger
                    confirmTitle={`Disable ${a.apiName}?`}
                    confirmMessage="Admin override: the API is rejected for all users until re-enabled. This stays Disabled even if the backend is healthy."
                    onConfirm={() => act(a.apiName, "disable")}
                  />
                )}
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </TableWrap>
  );
}
