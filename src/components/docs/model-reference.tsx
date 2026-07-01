import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { CATEGORIES } from "@/lib/constants";

export interface ModelRefItem {
  modelId: string;
  modelName: string;
  category: string;
  fn: string;
  backend: string;
  installed: boolean;
  status: string;
  devicePlan: string;
  vram: string;
  summary?: string;
  whenToUse?: string;
  endpoint?: string;
  notes?: string;
  example: string;
}

// Renders every model grouped by category, each with a description, when-to-use,
// the endpoint to call it through, live status, and a ready cURL example.
export function ModelReference({ items }: { items: ModelRefItem[] }) {
  return (
    <div className="space-y-5">
      {CATEGORIES.map((cat) => {
        const group = items.filter((m) => m.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">{cat}</h3>
            <div className="grid gap-3">
              {group.map((m) => (
                <Card key={m.modelId} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{m.modelName}</span>
                    <code className="rounded bg-bg-base px-1.5 py-0.5 font-mono text-xs text-ink-dim">{m.modelId}</code>
                    <CopyButton text={m.modelId} label="" />
                    <Badge tone="neutral" dot={false}>{m.devicePlan}</Badge>
                    {m.installed ? (
                      <StatusBadge status={m.status} dot={false} />
                    ) : (
                      <Badge tone="muted" dot={false}>Not installed</Badge>
                    )}
                    <span className="ml-auto font-mono text-xs text-muted">{m.vram}</span>
                  </div>

                  <p className="mt-2 text-sm text-ink-dim">{m.summary ?? m.fn}</p>
                  {m.whenToUse && (
                    <p className="mt-1 text-xs text-muted">
                      <span className="font-medium text-ink-dim">When to use: </span>
                      {m.whenToUse}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-medium text-ink-dim">Call via: </span>
                    <code className="font-mono text-ink-dim">{m.endpoint}</code>
                    {"  ·  backend: "}
                    {m.backend}
                  </p>
                  {m.notes && <p className="mt-1 text-xs text-warn">{m.notes}</p>}

                  {m.example && (
                    <div className="mt-2">
                      <CodeBlock title="example" code={m.example} />
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
