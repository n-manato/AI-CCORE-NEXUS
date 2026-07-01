"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { ModelRuntimeTable, type RowPatch } from "@/components/runtime/model-runtime-table";
import { VramForecastPanel } from "@/components/runtime/vram-forecast-panel";
import { VramWarningBanner } from "@/components/runtime/vram-warning-banner";
import { forecastVram, type ForecastModel, type ForecastResult } from "@/lib/vram";
import { postJson } from "@/lib/client";
import type { RuntimeRow } from "@/lib/runtime";

function toForecastModels(rows: RuntimeRow[]): ForecastModel[] {
  return rows.map((r) => ({
    modelId: r.modelId,
    modelName: r.modelName,
    category: r.category,
    enabled: r.enabled,
    startupPolicy: r.startupPolicy,
    devicePlan: r.devicePlan,
    estVramMinGb: r.estVramMinGb,
    estVramMaxGb: r.estVramMaxGb,
    maxConcurrent: r.maxConcurrent,
    multiGpuSupported: r.multiGpuSupported,
  }));
}

const EDITABLE = (r: RuntimeRow) => ({
  modelId: r.modelId,
  startupPolicy: r.startupPolicy,
  runtimeType: r.runtimeType,
  modelSizeClass: r.modelSizeClass,
  enabled: r.enabled,
  maxConcurrent: r.maxConcurrent,
});

export function RuntimePanel({ initialRows }: { initialRows: RuntimeRow[] }) {
  const router = useRouter();
  const signature = JSON.stringify(initialRows.map(EDITABLE));
  const [draft, setDraft] = useState<RuntimeRow[]>(initialRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmForecast, setConfirmForecast] = useState<ForecastResult | null>(null);

  // Re-sync the draft when the server data actually changes (after apply/reset).
  useEffect(() => {
    setDraft(initialRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const forecast = useMemo(() => forecastVram(toForecastModels(draft)), [draft]);

  const dirty = useMemo(
    () => JSON.stringify(draft.map(EDITABLE)) !== signature,
    [draft, signature],
  );

  function onEdit(modelId: string, patch: RowPatch) {
    setDraft((rows) => rows.map((r) => (r.modelId === modelId ? { ...r, ...patch } : r)));
    setError(null);
  }

  async function apply(confirm = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{
        ok: boolean;
        blocked?: boolean;
        needsConfirm?: boolean;
        forecast: ForecastResult;
      }>("/api/runtime/apply", { configs: draft.map(EDITABLE), confirm });

      if (res.ok) {
        setConfirmForecast(null);
        router.refresh();
        return;
      }
      if (res.blocked) {
        setError(`Apply blocked - ${res.forecast.status}: ${res.forecast.reason}`);
        setConfirmForecast(null);
        return;
      }
      if (res.needsConfirm) {
        setConfirmForecast(res.forecast);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Uncheck every model's "Enabled" in the draft. Nothing is persisted until the
  // user clicks Apply (so they can review the forecast first).
  function resetEnabled() {
    setDraft((rows) => rows.map((r) => ({ ...r, enabled: false })));
    setError(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <VramWarningBannerInline forecast={forecast} />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetEnabled} disabled={busy} title="Uncheck all Enabled (then Apply to save)">
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={() => apply(false)} disabled={!dirty || !forecast.canApply || busy}>
              <Save className="h-4 w-4" />
              {busy ? "Applying..." : "Apply"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!forecast.canApply && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            Apply is disabled while the forecast is {forecast.status}. Reduce enabled models or
            concurrency so each GPU stays within 24GB.
          </div>
        )}

        <ModelRuntimeTable rows={draft} onEdit={onEdit} />
      </div>

      <div className="lg:col-span-1">
        <div className="sticky top-20 space-y-3">
          <VramForecastPanel forecast={forecast} />
        </div>
      </div>

      {/* Apply validation dialog (Critical) */}
      <Modal
        open={!!confirmForecast}
        onClose={() => setConfirmForecast(null)}
        title="Confirm Critical VRAM configuration"
      >
        {confirmForecast && (
          <>
            <div className="mb-3 flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                This configuration is <b>Critical</b>: at least one GPU is predicted at or above 95%
                of its 24GB. Applying may cause out-of-memory errors under load.
              </span>
            </div>
            <div className="rounded-lg border border-border bg-bg-base p-2.5 text-xs text-ink-dim">
              GPU 0: {confirmForecast.gpu0Gb} GB - GPU 1: {confirmForecast.gpu1Gb} GB - Total:{" "}
              {confirmForecast.totalGb} GB
              <div className="mt-1 text-muted">{confirmForecast.reason}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmForecast(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={() => apply(true)} disabled={busy}>
                Apply anyway
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function VramWarningBannerInline({ forecast }: { forecast: ForecastResult }) {
  return (
    <div className="min-w-0 flex-1">
      <VramWarningBanner status={forecast.status} reason={forecast.reason} />
    </div>
  );
}
