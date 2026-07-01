import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { MaintenanceBanner } from "@/components/layout/maintenance-banner";
import type { NavItem } from "@/lib/nav";
import type { Role, GpuStatusValue, MaintenanceState } from "@/lib/constants";

// App shell used by both the admin and user layouts.
export function Shell({
  name,
  role,
  gpuStatus,
  maintenance,
  nav,
  children,
}: {
  name: string;
  role: Role;
  gpuStatus: GpuStatusValue;
  maintenance: MaintenanceState;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header name={name} role={role} gpuStatus={gpuStatus} maintenance={maintenance} />
      {maintenance === "On" && <MaintenanceBanner role={role} />}
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-bg-raised/50 md:block">
          <div className="sticky top-14">
            <Sidebar items={nav} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
