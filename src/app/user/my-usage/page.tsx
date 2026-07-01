import { Send, AlertTriangle, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChartView } from "@/components/charts/line-chart";
import { CHART } from "@/components/charts/palette";
import { requireUser } from "@/lib/auth";
import { getMyUsage } from "@/lib/queries";
import { formatRelative } from "@/lib/client";
import { CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Usage - Local AI Gateway" };

export default async function MyUsagePage() {
  const user = await requireUser();
  const u = await getMyUsage(user.id);

  return (
    <>
      <PageHeader title="My Usage" description="Your own request activity over the last 14 days." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Requests Today" value={u.requestsToday} icon={<Send className="h-5 w-5" />} />
        <MetricCard
          label="Errors (14d)"
          value={u.errors}
          tone={u.errors > 0 ? "warn" : "ok"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          label="Total (14d)"
          value={CATEGORIES.reduce((n, c) => n + u.counts[c], 0)}
          icon={<Send className="h-5 w-5" />}
        />
        <MetricCard
          label="Last Used"
          value={formatRelative(u.lastUsed)}
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Requests over time</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChartView
              data={u.overTime}
              series={[{ key: "requests", label: "Requests", color: CHART.accent }]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By category (14d)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {CATEGORIES.map((c) => (
                <li key={c} className="flex items-center justify-between text-sm">
                  <span className="text-ink-dim">{c}</span>
                  <span className="font-medium tabular-nums text-ink">{u.counts[c]}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
