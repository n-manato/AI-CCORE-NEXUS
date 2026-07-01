import type { Role } from "@/lib/constants";

// Sidebar navigation. `icon` is a string key resolved to a Lucide icon in the
// client Sidebar component (so we never pass components across the server
// boundary).
export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

export const ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "gauge" },
  { label: "Users & API Access", href: "/admin/users-access", icon: "users" },
  { label: "APIs", href: "/admin/apis", icon: "server" },
  { label: "Usage", href: "/admin/usage", icon: "bar-chart" },
  { label: "Model Runtime", href: "/admin/model-runtime", icon: "cpu" },
  { label: "Audit Logs", href: "/admin/audit-logs", icon: "scroll" },
  { label: "Server Logs", href: "/admin/server-logs", icon: "terminal" },
  { label: "API Guide", href: "/admin/api-guide", icon: "code" },
];

export const USER_NAV: NavItem[] = [
  { label: "My Access", href: "/user/my-access", icon: "key" },
  { label: "My Usage", href: "/user/my-usage", icon: "bar-chart" },
  { label: "How to Use", href: "/user/how-to-use", icon: "book" },
];

export function navForRole(role: Role): NavItem[] {
  return role === "admin" ? ADMIN_NAV : USER_NAV;
}
