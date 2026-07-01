import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Send,
  AlertTriangle,
  Server,
  ServerOff,
  Layers,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { GpuStatusCard } from "@/components/dashboard/gpu-status-card";
import { QueueStatusCard } from "@/components/dashboard/queue-status-card";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircularUsageMeter } from "@/components/charts/circular-usage-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDashboardData } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard - Local AI Gateway" };

export default async function AdminDashboard() {
  const d = await getDashboardData();
  const updated = new Date(d.lastUpdated).toLocaleTimeString();

  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader
        title="Dashboard"
        description="Server, GPU, queue, and API metrics for the shared AI server."
        actions={
          <span className="text-xs text-muted">
            Last updated {updated} - GPU data:{" "}
            <span className={d.gpuSource === "nvidia-smi" ? "text-ok" : "text-warn"}>
              {d.gpuSource === "nvidia-smi" ? "live (nvidia-smi)" : "mock"}
            </span>
          </span>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Server Status"
          value={d.serverStatus}
          tone={d.serverStatus === "Operational" ? "ok" : d.serverStatus === "Maintenance" ? "warn" : "danger"}
          icon={<Activity className="h-5 w-5" />}
          sublabel={`Uptime ${d.metrics.uptimeHours}h`}
        />
        <MetricCard
          label="Requests Today"
          value={d.requestsToday}
          icon={<Send className="h-5 w-5" />}
        />
        <MetricCard
          label="Errors Today"
          value={d.errorsToday}
          tone={d.errorsToday > 0 ? "warn" : "ok"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          label="Queue Count"
          value={d.queue}
          sublabel={`${d.runningJobs} running`}
          icon={<Layers className="h-5 w-5" />}
        />
        <MetricCard
          label="Running APIs"
          value={d.runningApis}
          tone="ok"
          sublabel={`of ${d.totalApis} total`}
          icon={<Server className="h-5 w-5" />}
        />
        <MetricCard
          label="Offline APIs"
          value={d.offlineApis}
          tone={d.offlineApis > 0 ? "warn" : "ok"}
          icon={<ServerOff className="h-5 w-5" />}
        />
        <MetricCard
          label="GPU Status"
          value={d.overallGpu}
          tone={d.overallGpu === "Available" ? "ok" : d.overallGpu === "Busy" ? "warn" : "danger"}
          icon={<Cpu className="h-5 w-5" />}
          sublabel={`avg VRAM ${d.avgVramPct}%`}
        />
        <MetricCard
          label="Peak GPU Temp"
          value={`${Math.round(d.maxTemp)}`}
          unit="°C"
          tone={d.maxTemp >= 85 ? "danger" : d.maxTemp >= 75 ? "warn" : "ok"}
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      {/* GPU cards */}
      <h2 className="mb-3 mt-6 text-sm font-medium text-ink-dim">GPU Status (per device)</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {d.gpuCards.map((g) => (
          <GpuStatusCard key={g.index} gpu={g} />
        ))}
      </div>

      {/* System + queue */}
      <h2 className="mb-3 mt-6 text-sm font-medium text-ink-dim">System Resources</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent className="flex justify-center">
            <CircularUsageMeter value={d.metrics.cpuPct} max={100} label="CPU" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>RAM Usage</CardTitle>
            <MemoryStick className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent className="flex justify-center">
            <CircularUsageMeter
              value={d.metrics.ramUsedGb}
              max={d.metrics.ramTotalGb}
              label="RAM"
              sublabel={`${d.metrics.ramUsedGb} / ${d.metrics.ramTotalGb} GB`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Disk Usage</CardTitle>
            <HardDrive className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent className="flex justify-center">
            <CircularUsageMeter
              value={d.metrics.diskUsedGb}
              max={d.metrics.diskTotalGb}
              label="Disk"
              sublabel={`${Math.round(d.metrics.diskUsedGb)} / ${Math.round(d.metrics.diskTotalGb)} GB`}
            />
          </CardContent>
        </Card>
        <QueueStatusCard counts={d.queueCounts} />
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-muted">
        <StatusBadge status={d.gpuSource === "nvidia-smi" ? "Online" : "Offline"} dot={false} />
        Metrics adapter: RAM/CPU/disk from host where available; GPU from{" "}
        {d.gpuSource}. Real per-model GPU job metrics can be wired in later.
      </div>
    </>
  );
}
