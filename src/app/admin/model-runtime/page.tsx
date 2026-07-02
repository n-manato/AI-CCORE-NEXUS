import { PageHeader } from "@/components/layout/page-header";
import { RuntimePanel } from "@/components/runtime/runtime-panel";
import { SyncButton } from "@/components/runtime/sync-button";
import { Card } from "@/components/ui/card";
import { getRuntimeRows } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model Runtime - Local AI Gateway" };

export default async function ModelRuntimePage() {
  const rows = await getRuntimeRows();
  return (
    <>
      <PageHeader
        title="Model Runtime & VRAM Planning"
        description="Control pinned and pressure-managed model residency. Active requests and Always Running models are protected while idle On Demand models are switched automatically."
        actions={<SyncButton />}
      />
      <Card className="mb-4 grid gap-3 p-4 text-xs text-ink-dim md:grid-cols-3">
        <div>
          <div className="font-medium text-ink">Always Running</div>
          Loaded and pinned. It is never evicted by the scheduler and is reserved in the VRAM plan.
        </div>
        <div>
          <div className="font-medium text-ink">On Demand</div>
          Stays resident after use. It is evicted only when another model needs VRAM; active models are protected.
        </div>
        <div>
          <div className="font-medium text-ink">Max Concurrent</div>
          Shared-weight backends add only KV-cache/workspace per extra request. Process-isolated backends add a full model instance.
        </div>
      </Card>
      <div className="relative left-1/2 w-[calc(100vw-2rem)] -translate-x-1/2 md:w-[calc(100vw-15rem-3rem)]">
        <RuntimePanel initialRows={rows} />
      </div>
    </>
  );
}
