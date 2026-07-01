import { Badge, type Tone } from "@/components/ui/badge";

// Central mapping from any status string to a badge tone, so colors stay
// consistent across the app. Text labels are always shown (never color alone).

const TONE_BY_STATUS: Record<string, Tone> = {
  // API status
  Online: "ok",
  Offline: "muted",
  Disabled: "muted",
  "Not Installed": "neutral",
  Error: "danger",
  // GPU status
  Available: "ok",
  Busy: "warn",
  Full: "danger",
  // Access
  Enabled: "ok",
  // Results
  "Available, but may be slow": "warn",
  "Temporarily unavailable": "warn",
  "Not allowed": "danger",
  "Not available": "muted",
  "Very busy, try later": "danger",
  "GPU unavailable": "danger",
  // VRAM status
  Safe: "ok",
  Caution: "warn",
  Warning: "warn",
  Critical: "danger",
  "Over Limit": "danger",
  "Invalid Combination": "danger",
  // Job status
  Waiting: "neutral",
  Running: "accent",
  Completed: "ok",
  Failed: "danger",
  Canceled: "muted",
  // Runtime state
  Stopped: "muted",
  Loading: "accent",
  // Roles / user status
  admin: "accent",
  user: "neutral",
  active: "ok",
  // Maintenance
  On: "warn",
  Scheduled: "warn",
  Off: "ok",
};

export function StatusBadge({
  status,
  dot = true,
  className,
}: {
  status: string;
  dot?: boolean;
  className?: string;
}) {
  const tone = TONE_BY_STATUS[status] ?? "neutral";
  return (
    <Badge tone={tone} dot={dot} className={className}>
      {status}
    </Badge>
  );
}

export function toneForStatus(status: string): Tone {
  return TONE_BY_STATUS[status] ?? "neutral";
}
