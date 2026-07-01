"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Gauge,
  Users,
  Server,
  BarChart3,
  Cpu,
  ScrollText,
  Terminal,
  KeyRound,
  BookOpen,
  Code2,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";
import { cn } from "@/lib/cn";

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  users: Users,
  server: Server,
  "bar-chart": BarChart3,
  cpu: Cpu,
  scroll: ScrollText,
  terminal: Terminal,
  key: KeyRound,
  book: BookOpen,
  code: Code2,
};

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? Gauge;
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent/10 text-accent shadow-[inset_2px_0_0_0_var(--tw-shadow-color)] shadow-accent"
                : "text-ink-dim hover:bg-bg-hover hover:text-ink",
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-muted")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
