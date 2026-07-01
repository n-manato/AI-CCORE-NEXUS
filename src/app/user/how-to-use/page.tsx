import { PageHeader } from "@/components/layout/page-header";
import { MyKeyCard } from "@/components/users/my-key-card";
import { EndpointDocView } from "@/components/docs/endpoint-doc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { requireUser } from "@/lib/auth";
import { getActiveKey } from "@/lib/keys";
import { prisma } from "@/lib/db";
import { computeDevicePlan } from "@/lib/runtime";
import { CATEGORIES, type Category } from "@/lib/constants";
import { ENDPOINTS, CORE_ENDPOINTS, ERROR_REFERENCE, fullUrl } from "@/lib/api-docs";

export const dynamic = "force-dynamic";
export const metadata = { title: "How to Use - Local AI Gateway" };

export default async function HowToUsePage() {
  const user = await requireUser();
  const [key, access, models, apis] = await Promise.all([
    getActiveKey(user.id),
    prisma.apiAccess.findMany({ where: { userId: user.id, enabled: true } }),
    prisma.modelRegistry.findMany({
      where: { installed: true },
      include: { runtimeState: true, runtimeConfig: true },
      orderBy: [{ category: "asc" }, { modelName: "asc" }],
    }),
    prisma.apiStatus.findMany(),
  ]);

  const isAdmin = user.role === "admin";
  const allowed = new Set(access.map((a) => a.category as Category));
  const allowedCats = CATEGORIES.filter((c) => isAdmin || allowed.has(c));
  const statusByApi = new Map(apis.map((a) => [a.apiName, a.status]));

  const base = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ?? "https://ai-gateway.example.edu/v1";
  const catalog = models.filter((m) => isAdmin || allowed.has(m.category as Category));

  const quickstart = `# 1) Put your key in an environment variable
export LAG_API_KEY="lag_xxx"   # copy it from the box above

# 2) List the models you can use
curl ${fullUrl(base, "/v1/models")} \\
  -H "Authorization: Bearer $LAG_API_KEY"

# 3) Call an endpoint (example: chat)
curl ${fullUrl(base, "/v1/chat/completions")} \\
  -H "Authorization: Bearer $LAG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"Hello"}]}'`;

  return (
    <>
      <PageHeader
        title="How to Use"
        description="Build against the Local AI Gateway with your API key. Only the APIs you are allowed to use are shown."
      />

      {/* Getting started */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Base URL & authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-bg-base px-3 py-2 font-mono text-sm text-ink">{base}</code>
              <CopyButton text={base} />
            </div>
            <p className="text-xs text-muted">
              Every request needs{" "}
              <code className="font-mono text-ink-dim">Authorization: Bearer &lt;API_KEY&gt;</code>. The key must
              never appear in the URL. Use over VPN; HTTPS is required in production. Local dev base URL is{" "}
              <code className="font-mono text-ink-dim">http://localhost:3000/v1</code>.
            </p>
          </CardContent>
        </Card>

        <MyKeyCard
          userId={user.id}
          prefix={key?.keyPrefix ?? null}
          last4={key?.last4 ?? null}
          status={key?.status ?? null}
        />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">2. Quickstart</h2>
      <CodeBlock title="quickstart.sh" code={quickstart} />

      {/* Model selection */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">3. Choosing a model</h2>
      <Card className="mb-3">
        <CardContent className="pt-4 text-sm text-ink-dim">
          <p>
            Call <code className="font-mono text-ink">GET /v1/models</code> to see the models your key can use,
            then pass a model <code className="font-mono text-ink">id</code> in the request body (the{" "}
            <code className="font-mono text-ink">model</code> field). Pick a <b>fast</b> model for interactive use
            and a <b>quality</b> model for harder tasks. Larger models may be <code className="font-mono">2GPU</code>{" "}
            or run as queued <b>Jobs</b>. If a model is not currently running it may take longer on the first call
            (cold start).
          </p>
        </CardContent>
      </Card>

      <h3 className="mb-2 text-xs font-medium text-muted">Available models for your account</h3>
      {catalog.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted">
            No installed models in your allowed categories yet.
          </CardContent>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <TR>
              <TH>Model id</TH>
              <TH>Category</TH>
              <TH>Function</TH>
              <TH>Backend</TH>
              <TH>Device Plan</TH>
              <TH>Status</TH>
              <TH className="text-right">Est. VRAM</TH>
            </TR>
          </THead>
          <TBody>
            {catalog.map((m) => (
              <TR key={m.modelId}>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <code className="rounded bg-bg-base px-1.5 py-0.5 font-mono text-xs text-ink">{m.modelId}</code>
                    <CopyButton text={m.modelId} label="" />
                  </div>
                </TD>
                <TD className="text-ink-dim">{m.category}</TD>
                <TD className="text-ink-dim">{m.function}</TD>
                <TD className="text-muted">{m.backend}</TD>
                <TD>
                  <Badge tone="neutral" dot={false}>
                    {computeDevicePlan(m).plan}
                  </Badge>
                </TD>
                <TD>
                  <StatusBadge status={m.runtimeState?.currentStatus ?? "Stopped"} />
                </TD>
                <TD className="whitespace-nowrap text-right font-mono text-xs text-muted">
                  {m.estimatedVramMinGb}-{m.estimatedVramMaxGb} GB
                </TD>
              </TR>
            ))}
          </TBody>
        </TableWrap>
      )}

      {/* Core endpoints */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">4. Core endpoints</h2>
      <div className="grid gap-3">
        {CORE_ENDPOINTS.map((ep) => (
          <EndpointDocView key={ep.path + ep.name} ep={ep} base={base} />
        ))}
      </div>

      {/* Per-category endpoints */}
      {allowedCats.map((cat) => {
        const eps = ENDPOINTS.filter((e) => e.category === cat);
        if (eps.length === 0) return null;
        return (
          <div key={cat}>
            <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">{cat} endpoints</h2>
            <div className="grid gap-3">
              {eps.map((ep) => (
                <EndpointDocView
                  key={ep.path}
                  ep={ep}
                  base={base}
                  status={statusByApi.get(ep.apiName) ?? null}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Error reference */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">Error reference</h2>
      <TableWrap>
        <THead>
          <TR>
            <TH>HTTP</TH>
            <TH>Code</TH>
            <TH>Message</TH>
            <TH>When</TH>
          </TR>
        </THead>
        <TBody>
          {ERROR_REFERENCE.map((e) => (
            <TR key={e.status + e.code}>
              <TD className="font-mono text-xs text-ink">{e.status}</TD>
              <TD className="font-mono text-xs text-accent">{e.code}</TD>
              <TD className="text-xs text-ink-dim">{e.message}</TD>
              <TD className="text-xs text-muted">{e.when}</TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>
      <p className="mt-2 text-xs text-muted">
        All errors share the shape{" "}
        <code className="font-mono text-ink-dim">{`{ "error": { "message", "type", "code" } }`}</code>. Note: responses
        from the model backends are currently mock data.
      </p>

      {/* Rules + contact */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usage rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-dim">
              <li>Use only the APIs your account is allowed to use.</li>
              <li>Keep your API key secret. Never commit it or put it in a URL.</li>
              <li>Heavy jobs (image, video) are queued and may run one at a time; poll the job_id.</li>
              <li>During maintenance, requests are temporarily disabled for normal users.</li>
              <li>If the GPU is Busy or Full, responses may be slow or rejected (retry later).</li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink-dim">
            <p>Questions, access requests, or issues:</p>
            <p className="mt-1 font-mono text-ink">lab-admin@your-institution.example</p>
            <p className="mt-2 text-xs text-muted">(Placeholder - update with your lab contact.)</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
