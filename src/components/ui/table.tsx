import { cn } from "@/lib/cn";

// Lightweight, scannable table primitives shared by the admin/user tables.

export function TableWrap({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-bg-raised text-xs uppercase tracking-wide text-muted">
      {children}
    </thead>
  );
}

export function TR({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <tr className={cn("border-b border-border/60 last:border-0", className)}>{children}</tr>
  );
}

export function TH({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th className={cn("px-3 py-2.5 text-left font-medium", className)}>{children}</th>
  );
}

export function TD({
  className,
  children,
  colSpan,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} className={cn("px-3 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="[&>tr:hover]:bg-bg-hover/50">{children}</tbody>;
}
