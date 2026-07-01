import { requireUser } from "@/lib/auth";
import { getHeaderContext } from "@/lib/system";
import { Shell } from "@/components/layout/shell";
import { USER_NAV } from "@/lib/nav";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { gpuStatus, maintenance } = await getHeaderContext();
  return (
    <Shell
      name={user.name}
      role="user"
      gpuStatus={gpuStatus}
      maintenance={maintenance}
      nav={USER_NAV}
    >
      {children}
    </Shell>
  );
}
