import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "muted";

const tones: Record<Tone, string> = {
  neutral: "bg-bg-hover text-ink border-border",
  accent: "bg-accent/10 text-accent border-accent/30",
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  muted: "bg-muted/10 text-muted border-muted/30",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  dot,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "ok" && "bg-ok animate-pulse-glow",
            tone === "warn" && "bg-warn",
            tone === "danger" && "bg-danger",
            tone === "accent" && "bg-accent animate-pulse-glow",
            (tone === "neutral" || tone === "muted") && "bg-muted",
          )}
        />
      )}
      {children}
    </span>
  );
}
