import { PageHeader } from "@/components/layout/page-header";
import { RuntimePanel } from "@/components/runtime/runtime-panel";
import { SyncButton } from "@/components/runtime/sync-button";
import { getRuntimeRows } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model Runtime - Local AI Gateway" };

export default async function ModelRuntimePage() {
  const rows = await getRuntimeRows();
  return (
    <>
      <PageHeader
        title="Model Runtime & VRAM Planning"
        description="Edit startup policy, runtime type, size class, enablement and concurrency. Device Plan is system-calculated and read-only. The VRAM forecast updates live."
        actions={<SyncButton />}
      />
      <RuntimePanel initialRows={rows} />
    </>
  );
}
