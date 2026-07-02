import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { LineChartView } from "@/components/charts/line-chart";
import { BarChartView } from "@/components/charts/bar-chart";
import { DonutChartView } from "@/components/charts/donut-chart";
import { CHART, SERIES } from "@/components/charts/palette";
import { getAdminUsage } from "@/lib/queries";
import { formatRelative } from "@/lib/client";
import { CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage - Local AI Gateway" };

export default async function AdminUsagePage() {
  const u = await getAdminUsage();

  // Stacked-area series for only the categories that actually have traffic.
  const activeCats = u.byCategory.map((c) => c.name);
  const catSeries = CATEGORIES.filter((c) => activeCats.includes(c)).map((c, i) => ({
    key: c,
    label: c,
    color: SERIES[i % SERIES.length],
  }));

  // Give horizontal bars enough vertical room per bar so labels aren't crowded.
  const barHeight = (n: number, per = 32, min = 240) => Math.max(min, n * per);

  return (
    <>
      <PageHeader title="Usage" description="Request volume, API mix, model errors, and per-user activity over the last 14 days." />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Requests over time</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChartView
              data={u.overTime}
              series={[
                { key: "requests", label: "Requests", color: CHART.accent },
                { key: "errors", label: "Errors", color: CHART.danger },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Requests by category over time</CardTitle>
          </CardHeader>
          <CardContent>
            {catSeries.length ? (
              <>
                <Legend items={catSeries} />
                <LineChartView data={u.categoryOverTime} series={catSeries} stacked />
              </>
            ) : (
              <Empty />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API usage ratio</CardTitle>
          </CardHeader>
          <CardContent>
            {u.byCategory.length ? <DonutChartView data={u.byCategory} /> : <Empty />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Errors by model</CardTitle>
          </CardHeader>
          <CardContent>
            {u.errorsByModel.length ? (
              <BarChartView
                data={u.errorsByModel}
                dataKey="value"
                horizontal
                showValues
                labelWidth={160}
                color={CHART.danger}
                height={barHeight(u.errorsByModel.length)}
              />
            ) : (
              <Empty label="No errors recorded." />
            )}
          </CardContent>
        </Card>

      </div>

      <h2 className="mb-3 mt-6 text-sm font-medium text-ink-dim">Per-user usage</h2>
      <TableWrap>
        <THead>
          <TR>
            <TH>User</TH>
            <TH className="text-right">LLM</TH>
            <TH className="text-right">TTS</TH>
            <TH className="text-right">STT</TH>
            <TH className="text-right">Image</TH>
            <TH className="text-right">Vision</TH>
            <TH className="text-right">Video</TH>
            <TH className="text-right">Motion</TH>
            <TH className="text-right">Total</TH>
            <TH className="text-right">Errors</TH>
            <TH>Last Used</TH>
          </TR>
        </THead>
        <TBody>
          {u.rows.map((r) => (
            <TR key={r.userId}>
              <TD>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.name}</span>
                  <StatusBadge status={r.role} dot={false} />
                </div>
                <div className="text-xs text-muted">{r.email}</div>
              </TD>
              <TD className="text-right tabular-nums">{r.LLM}</TD>
              <TD className="text-right tabular-nums">{r.TTS}</TD>
              <TD className="text-right tabular-nums">{r.STT}</TD>
              <TD className="text-right tabular-nums">{r.Image}</TD>
              <TD className="text-right tabular-nums">{r.Vision}</TD>
              <TD className="text-right tabular-nums">{r.Video}</TD>
              <TD className="text-right tabular-nums">{r.Motion}</TD>
              <TD className="text-right font-semibold tabular-nums text-ink">{r.total}</TD>
              <TD className="text-right tabular-nums">
                <span className={r.errors > 0 ? "text-warn" : "text-muted"}>{r.errors}</span>
              </TD>
              <TD className="whitespace-nowrap text-xs text-muted">{formatRelative(r.lastUsed)}</TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>
    </>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Empty({ label = "No data yet." }: { label?: string }) {
  return <div className="py-10 text-center text-sm text-muted">{label}</div>;
}
