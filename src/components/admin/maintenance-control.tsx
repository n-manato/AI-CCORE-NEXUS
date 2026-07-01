"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, Power, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Modal } from "@/components/ui/dialog";
import { postJson } from "@/lib/client";

type JobPolicy = "continue" | "cancel" | "pause";

const POLICIES: { value: JobPolicy; label: string; desc: string }[] = [
  { value: "continue", label: "Continue running jobs", desc: "Running jobs finish; waiting jobs are paused." },
  { value: "cancel", label: "Cancel running jobs", desc: "Running jobs are canceled; waiting jobs are paused." },
  { value: "pause", label: "Pause queue only", desc: "No new work starts; current jobs are untouched." },
];

export function MaintenanceControl({
  state,
  jobPolicy,
}: {
  state: string;
  jobPolicy: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<JobPolicy>((jobPolicy as JobPolicy) || "pause");
  const [busy, setBusy] = useState(false);

  async function setState(next: string, pol?: JobPolicy) {
    setBusy(true);
    try {
      await postJson("/api/maintenance", { state: next, jobPolicy: pol ?? policy });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance Mode</CardTitle>
        <Wrench className="h-4 w-4 text-warn" />
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-muted">Current:</span>
          <StatusBadge status={state} />
        </div>
        <p className="mb-3 text-xs text-ink-dim">
          When ON, new API requests from normal users are blocked. Admins can still test APIs.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={state === "Off" ? "primary" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => setState("Off")}
          >
            <Power className="h-3.5 w-3.5" />
            Set Off
          </Button>
          <Button
            variant={state === "Scheduled" ? "primary" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => setState("Scheduled")}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Schedule
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setOpen(true)}>
            <Wrench className="h-3.5 w-3.5" />
            Turn On
          </Button>
        </div>
      </CardContent>

      <Modal open={open} onClose={() => setOpen(false)} title="Turn on Maintenance Mode">
        <p className="mb-3 text-sm text-ink-dim">
          Choose how existing jobs should be handled. New requests from normal users will be
          rejected with the standard maintenance message.
        </p>
        <div className="space-y-2">
          {POLICIES.map((p) => (
            <label
              key={p.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-2.5 hover:bg-bg-hover"
            >
              <input
                type="radio"
                name="policy"
                className="mt-1 accent-[#22d3ee]"
                checked={policy === p.value}
                onChange={() => setPolicy(p.value)}
              />
              <div>
                <div className="text-sm text-ink">{p.label}</div>
                <div className="text-xs text-muted">{p.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => setState("On", policy)} disabled={busy}>
            {busy ? "Working..." : "Turn On Maintenance"}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
