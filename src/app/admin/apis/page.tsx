import { PageHeader } from "@/components/layout/page-header";
import { ApiStatusTable } from "@/components/apis/api-status-table";
import { MaintenanceControl } from "@/components/admin/maintenance-control";
import { JobQueuePanel } from "@/components/admin/job-queue-panel";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { prisma } from "@/lib/db";
import { getApisOverview } from "@/lib/queries";
import { getSetting, getMaintenanceState } from "@/lib/system";
import { SETTING_KEYS } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "APIs - Local AI Gateway" };

export default async function AdminApisPage() {
  const [{ apis }, maintenance, jobPolicy, jobs] = await Promise.all([
    getApisOverview(),
    getMaintenanceState(),
    getSetting(SETTING_KEYS.maintenanceJobPolicy),
    prisma.job.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { user: { select: { name: true } } },
      take: 50,
    }),
  ]);

  const apiRows = apis.map((a) => ({
    apiName: a.apiName,
    category: a.category,
    status: a.status,
    currentModel: a.currentModel,
    backend: a.backend,
    mode: a.mode,
    usesGpu: a.usesGpu,
    queueCount: a.queueCount,
    runningCount: a.runningCount,
    averageResponseTime: a.averageResponseTime,
    errorCount: a.errorCount,
    lastChecked: a.lastChecked.toISOString(),
    description: a.description,
    adminDisabled: a.adminDisabled,
  }));

  const jobRows = jobs.map((j) => ({
    id: j.id,
    apiName: j.apiName,
    userName: j.user.name,
    status: j.status,
    priority: j.priority,
    progress: j.progress,
    createdAt: j.createdAt.toISOString(),
  }));

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader
        title="APIs"
        description="System-wide API state and admin operations. This page shows API status, not per-user permissions."
      />

      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <MaintenanceControl state={maintenance} jobPolicy={jobPolicy ?? "pause"} />
        </div>
        <div className="lg:col-span-2">
          <JobQueuePanel jobs={jobRows} />
        </div>
      </div>

      <h2 className="mb-3 text-sm font-medium text-ink-dim">API Status ({apiRows.length})</h2>
      <ApiStatusTable apis={apiRows} />
    </>
  );
}
