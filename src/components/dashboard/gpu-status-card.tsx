import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { CircularUsageMeter } from "@/components/charts/circular-usage-meter";
import { TemperatureGauge } from "@/components/charts/temperature-gauge";
import { GPU_VRAM_GB, type GpuStatusValue } from "@/lib/constants";

export interface GpuCardData {
  index: number;
  name: string;
  memUsedGb: number;
  memTotalGb: number;
  memUsedPct: number;
  utilizationPct: number;
  temperatureC: number;
  status: GpuStatusValue;
}

// Detailed per-GPU card: VRAM meter, utilization meter, temperature gauge.
export function GpuStatusCard({ gpu }: { gpu: GpuCardData }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">GPU {gpu.index}</div>
          <div className="text-xs text-muted">{gpu.name}</div>
        </div>
        <StatusBadge status={gpu.status} />
      </div>
      <div className="flex items-center justify-around gap-2">
        <CircularUsageMeter
          value={gpu.memUsedGb}
          max={gpu.memTotalGb || GPU_VRAM_GB}
          unit="%"
          size={104}
          label="VRAM"
          sublabel={`${gpu.memUsedGb.toFixed(1)} / ${gpu.memTotalGb.toFixed(0)} GB`}
        />
        <CircularUsageMeter
          value={gpu.utilizationPct}
          max={100}
          unit="%"
          size={104}
          label="GPU Usage"
        />
        <TemperatureGauge tempC={gpu.temperatureC} label="Temp" size={130} />
      </div>
    </Card>
  );
}
