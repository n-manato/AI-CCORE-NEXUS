"use client";

import { useRouter } from "next/navigation";
import { Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdminActionButton } from "@/components/ui/admin-action-button";
import { postJson, formatRelative } from "@/lib/client";

export interface JobRow {
  id: string;
  apiName: string;
  userName: string;
  status: string;
  priority: number;
  progress: number;
  createdAt: string;
}

export function JobQueuePanel({ jobs }: { jobs: JobRow[] }) {
  const router = useRouter();
  const hasWaiting = jobs.some((j) => j.status === "Waiting");

  async function cancel(id: string) {
    await postJson("/api/jobs/cancel", { jobId: id });
    router.refresh();
  }
  async function clearQueue() {
    await postJson("/api/queue/clear");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Queue</CardTitle>
        <AdminActionButton
          label="Clear Queue"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          danger
          disabled={!hasWaiting}
          confirmTitle="Clear the queue?"
          confirmMessage="All waiting jobs will be canceled. Running jobs are not affected."
          onConfirm={clearQueue}
        />
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No jobs in the system.</p>
        ) : (
          <TableWrap>
            <THead>
              <TR>
                <TH>API</TH>
                <TH>User</TH>
                <TH>Status</TH>
                <TH className="text-right">Priority</TH>
                <TH className="text-right">Progress</TH>
                <TH>Created</TH>
                <TH className="text-right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {jobs.map((j) => {
                const finished = j.status === "Completed" || j.status === "Canceled" || j.status === "Failed";
                return (
                  <TR key={j.id}>
                    <TD className="font-medium text-ink">{j.apiName}</TD>
                    <TD className="text-ink-dim">{j.userName}</TD>
                    <TD>
                      <StatusBadge status={j.status} />
                    </TD>
                    <TD className="text-right tabular-nums">{j.priority}</TD>
                    <TD className="text-right tabular-nums">{j.progress}%</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatRelative(j.createdAt)}</TD>
                    <TD className="text-right">
                      {!finished && (
                        <AdminActionButton
                          label="Cancel"
                          icon={<XCircle className="h-3.5 w-3.5" />}
                          danger
                          confirmTitle="Cancel this job?"
                          confirmMessage={`${j.apiName} job for ${j.userName} will be canceled.`}
                          onConfirm={() => cancel(j.id)}
                        />
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </TableWrap>
        )}
      </CardContent>
    </Card>
  );
}
