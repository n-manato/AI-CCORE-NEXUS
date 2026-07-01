"use client";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { CodeTabs } from "@/components/docs/code-tabs";
import { examplesFor, type EndpointDoc } from "@/lib/api-docs";

// Renders one endpoint as an OpenAI-style reference block: method/path, summary,
// model selection, params table, request examples (cURL/Python/Node), response.
export function EndpointDocView({
  ep,
  base,
  status,
}: {
  ep: EndpointDoc;
  base: string;
  status?: string | null;
}) {
  const ex = examplesFor(base, ep);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ep.method === "GET" ? "ok" : "accent"} dot={false} className="font-mono">
          {ep.method}
        </Badge>
        <code className="font-mono text-sm text-ink">{ep.path}</code>
        <Badge tone="neutral" dot={false}>
          {ep.mode}
        </Badge>
        {ep.implemented === "skeleton" && (
          <Badge tone="warn" dot={false}>
            mock skeleton
          </Badge>
        )}
        {status && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            current status: <StatusBadge status={status} dot={false} />
          </span>
        )}
      </div>

      <h3 className="mt-2 text-base font-semibold text-ink">{ep.name}</h3>
      <p className="mt-1 text-sm text-ink-dim">{ep.summary}</p>

      {ep.modelSelection && (
        <p className="mt-2 rounded-md border border-border bg-bg-base/60 px-3 py-2 text-xs text-ink-dim">
          <span className="font-medium text-accent">Model selection: </span>
          {ep.modelSelection}
        </p>
      )}

      {ep.notes && (
        <p className="mt-2 text-xs text-warn">{ep.notes}</p>
      )}

      {ep.params.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-muted">Parameters</div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {ep.params.map((p) => (
                  <tr key={p.name} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs text-ink">{p.name}</td>
                    <td className="px-3 py-1.5 text-xs text-muted">{p.type}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {p.required ? (
                        <span className="text-danger">required</span>
                      ) : (
                        <span className="text-muted">optional</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-ink-dim">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 text-xs font-medium text-muted">Request</div>
        <CodeTabs
          tabs={[
            { label: "cURL", code: ex.curl },
            { label: "Python", code: ex.python },
            { label: "Node", code: ex.node },
          ]}
        />
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-medium text-muted">Response</div>
        <CodeBlock title={ep.binaryResponse ? "binary" : "json"} code={ep.responseExample} />
      </div>
    </Card>
  );
}
