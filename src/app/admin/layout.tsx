import { requireAdmin } from "@/lib/auth";
import { getHeaderContext } from "@/lib/system";
import { Shell } from "@/components/layout/shell";
import { ADMIN_NAV } from "@/lib/nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const { gpuStatus, maintenance } = await getHeaderContext();
  return (
    <Shell
      name={user.name}
      role="admin"
      gpuStatus={gpuStatus}
      maintenance={maintenance}
      nav={ADMIN_NAV}
    >
      {children}
    </Shell>
  );
}
