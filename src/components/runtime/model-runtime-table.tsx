"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Power } from "lucide-react";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { DevicePlanBadge } from "@/components/runtime/device-plan-badge";
import { AdminActionButton } from "@/components/ui/admin-action-button";
import { postJson } from "@/lib/client";
import { STARTUP_POLICIES, type DevicePlan } from "@/lib/constants";
import type { RuntimeRow } from "@/lib/runtime";

export type RowPatch = Partial<
  Pick<RuntimeRow, "startupPolicy" | "runtimeType" | "modelSizeClass" | "enabled" | "maxConcurrent">
>;

// The Model ID rendered as the exact string to paste into Cline's "Model ID"
// field (the full Ollama tag with size/quant). Click to copy.
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy this Model ID (paste into Cline)"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable (e.g. non-HTTPS) — text is still selectable */
        }
      }}
      className="group inline-flex items-center gap-1.5 font-mono font-medium text-ink hover:text-[#22d3ee]"
    >
      <span className="select-all">{value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}

export function ModelRuntimeTable({
  rows,
  onEdit,
}: {
  rows: RuntimeRow[];
  onEdit: (modelId: string, patch: RowPatch) => void;
}) {
  const router = useRouter();

  async function modelAction(modelId: string, action: "unload" | "reload") {
    await postJson("/api/runtime/model-action", { modelId, action });
    router.refresh();
  }

  return (
    <TableWrap>
      <THead>
        <TR>
          <TH>Model ID</TH>
          <TH>Category</TH>
          <TH>Device Plan</TH>
          <TH>Startup Policy</TH>
          <TH>Runtime Type</TH>
          <TH>Size Class</TH>
          <TH className="text-center">Enabled</TH>
          <TH className="text-right">
            <span title="Maximum in-flight requests. Shared model weights are counted once; extra requests add workspace headroom.">Max Conc.</span>
          </TH>
          <TH className="text-right">Est. VRAM</TH>
          <TH>State</TH>
          <TH className="text-right">Ops</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const locked = r.devicePlan === "Not Installed";
          return (
            <TR key={r.modelId}>
              <TD>
                <CopyId value={r.ollamaTag ?? r.modelId} />
                <div className="text-xs text-muted">
                  {r.modelName} · {r.function} - {r.backend}
                </div>
              </TD>
              <TD className="text-ink-dim">{r.category}</TD>
              <TD>
                <DevicePlanBadge plan={r.devicePlan as DevicePlan} reason={r.devicePlanReason} />
              </TD>
              <TD>
                <Select
                  value={r.startupPolicy}
                  disabled={locked}
                  onChange={(e) => onEdit(r.modelId, { startupPolicy: e.target.value as RuntimeRow["startupPolicy"] })}
                  className="w-36"
                >
                  {STARTUP_POLICIES.filter((p) => p !== "Disabled").map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </TD>
              <TD>
                {/* read-only: descriptive, not runtime-enforced */}
                <span className="text-xs text-muted" title="Descriptive label (read-only)">{r.runtimeType}</span>
              </TD>
              <TD>
                <span className="text-xs text-muted" title="Descriptive label (read-only)">{r.modelSizeClass}</span>
              </TD>
              <TD className="text-center">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  disabled={locked}
                  onChange={(e) => onEdit(r.modelId, { enabled: e.target.checked })}
                  className="h-4 w-4 accent-[#22d3ee] disabled:opacity-40"
                />
              </TD>
              <TD className="text-right">
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={r.maxConcurrent}
                  disabled={locked}
                  onChange={(e) =>
                    onEdit(r.modelId, { maxConcurrent: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })
                  }
                  className="h-8 w-16 rounded-md border border-border bg-bg-raised px-2 text-right text-sm text-ink disabled:opacity-40"
                />
              </TD>
              <TD className="whitespace-nowrap text-right font-mono text-xs text-ink-dim">
                {r.estVramMinGb}-{r.estVramMaxGb} GB
              </TD>
              <TD>
                <StatusBadge status={r.currentStatus} />
              </TD>
              <TD>
                <div className="flex justify-end gap-1.5">
                  {/* Loading is driven by config (Apply loads Always-Running models;
                      others load on demand). Unload stays as a manual free-VRAM op. */}
                  {r.installed && r.currentStatus === "Running" && (
                    <AdminActionButton
                      label="Unload"
                      icon={<Power className="h-3.5 w-3.5" />}
                      danger
                      confirmTitle={`Unload ${r.modelId}?`}
                      confirmMessage="Free this model from VRAM now. Always-Running models reload on the next Apply/tick; others load on demand."
                      onConfirm={() => modelAction(r.modelId, "unload")}
                    />
                  )}
                  {r.installed && r.currentStatus !== "Running" && (
                    <span className="text-xs text-muted">—</span>
                  )}
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </TableWrap>
  );
}
