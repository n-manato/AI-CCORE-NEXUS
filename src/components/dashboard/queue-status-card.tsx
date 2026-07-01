import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ListChecks } from "lucide-react";

export interface QueueCounts {
  waiting: number;
  running: number;
  completed: number;
  failed: number;
  canceled: number;
}

// Queue overview with per-status breakdown.
export function QueueStatusCard({ counts }: { counts: QueueCounts }) {
  const rows: { status: string; n: number }[] = [
    { status: "Waiting", n: counts.waiting },
    { status: "Running", n: counts.running },
    { status: "Completed", n: counts.completed },
    { status: "Failed", n: counts.failed },
    { status: "Canceled", n: counts.canceled },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Queue</CardTitle>
        <ListChecks className="h-4 w-4 text-accent" />
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-ink">{counts.waiting + counts.running}</span>
          <span className="text-xs text-muted">active (waiting + running)</span>
        </div>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.status} className="flex items-center justify-between text-sm">
              <StatusBadge status={r.status} dot={false} />
              <span className="font-medium text-ink">{r.n}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
