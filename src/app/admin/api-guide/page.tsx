import { PageHeader } from "@/components/layout/page-header";
import { MyKeyCard } from "@/components/users/my-key-card";
import { EndpointDocView } from "@/components/docs/endpoint-doc";
import { CodeTabs } from "@/components/docs/code-tabs";
import { ModelReference, type ModelRefItem } from "@/components/docs/model-reference";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { CopyButton } from "@/components/ui/copy-button";
import { requireAdmin } from "@/lib/auth";
import { getActiveKey } from "@/lib/keys";
import { prisma } from "@/lib/db";
import { computeDevicePlan } from "@/lib/runtime";
import { ENDPOINTS, CORE_ENDPOINTS } from "@/lib/api-docs";
import { MODEL_DOCS, modelCurl } from "@/lib/model-docs";
import {
  CHAT_PARAMS,
  OPENAI_MODEL_MAP,
  TROUBLESHOOTING,
  envMinimal,
  envExplicit,
  pyOpenAiSdk,
  nodeOpenAiSdk,
  claudeCodeSnippet,
} from "@/lib/integration-docs";

export const dynamic = "force-dynamic";
export const metadata = { title: "API Guide - Local AI Gateway" };

export default async function ApiGuidePage() {
  const admin = await requireAdmin();
  const base = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ?? "https://ai-gateway.example.edu/v1";

  const [key, allModels, apis] = await Promise.all([
    getActiveKey(admin.id),
    prisma.modelRegistry.findMany({
      include: { runtimeState: true },
      orderBy: [{ category: "asc" }, { modelName: "asc" }],
    }),
    prisma.apiStatus.findMany(),
  ]);

  const statusByApi = new Map(apis.map((a) => [a.apiName, a.status]));

  const modelItems: ModelRefItem[] = allModels.map((m) => {
    const doc = MODEL_DOCS[m.modelId];
    const endpoint = doc?.endpoint;
    return {
      modelId: m.modelId,
      modelName: m.modelName,
      category: m.category,
      fn: m.function,
      backend: m.backend,
      installed: m.installed,
      status: m.runtimeState?.currentStatus ?? "Stopped",
      devicePlan: computeDevicePlan(m).plan,
      vram: `${m.estimatedVramMinGb}-${m.estimatedVramMaxGb} GB`,
      summary: doc?.summary,
      whenToUse: doc?.whenToUse,
      endpoint,
      notes: doc?.notes,
      example: endpoint ? modelCurl(base, m.modelId, endpoint) : "",
    };
  });

  // OpenAI-compatible endpoints to show in full here.
  const modelsEp = CORE_ENDPOINTS.find((e) => e.path === "/v1/models")!;
  const compatNames = ["LLM Chat", "TTS", "STT"];
  const compatEps = compatNames
    .map((n) => ENDPOINTS.find((e) => e.apiName === n))
    .filter((e): e is NonNullable<typeof e> => !!e);

  return (
    <>
      <PageHeader
        title="API Guide & OpenAI Migration"
        description="How to call the gateway from a new app, migrate from an OpenAI key, and use every model/parameter without errors. The gateway's /v1 is OpenAI-compatible."
      />

      {/* 1. Key + base + env */}
      <h2 className="mb-2 text-sm font-medium text-ink-dim">1. Your key, base URL & .env</h2>
      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Base URL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-bg-base px-3 py-2 font-mono text-sm text-ink">{base}</code>
              <CopyButton text={base} />
            </div>
            <p className="text-xs text-muted">
              Must end with <code className="font-mono text-ink-dim">/v1</code>. Local dev:{" "}
              <code className="font-mono text-ink-dim">http://localhost:3000/v1</code>.
            </p>
          </CardContent>
        </Card>
        <MyKeyCard userId={admin.id} prefix={key?.keyPrefix ?? null} last4={key?.last4 ?? null} status={key?.status ?? null} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted">.env for a new app (recommended)</div>
          <CodeBlock title=".env" code={envExplicit(base)} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Minimal migration (reuse OpenAI env names)</div>
          <CodeBlock title=".env" code={envMinimal(base)} />
        </div>
      </div>

      {/* 2. Migrate from OpenAI */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">2. Migrating from an OpenAI key</h2>
      <Card className="mb-3">
        <CardContent className="pt-4 text-sm text-ink-dim">
          <p>
            The gateway speaks the OpenAI API, so you keep the official{" "}
            <code className="font-mono text-ink">openai</code> SDK and only change two things:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Point the SDK at this <b>base URL</b> (set <code className="font-mono">base_url</code>/
              <code className="font-mono">baseURL</code>, or the <code className="font-mono">OPENAI_BASE_URL</code> env var).
            </li>
            <li>
              Use your <b>gateway key</b> (<code className="font-mono">lag_...</code>) as the API key, and a{" "}
              <b>gateway model id</b> (e.g. <code className="font-mono">qwen3-8b</code>) instead of an OpenAI model name.
            </li>
          </ol>
          <p className="mt-2">
            Extra OpenAI parameters (temperature, top_p, penalties, seed, …) are accepted and never error.{" "}
            <span className="text-warn">Two exceptions:</span> keep <code className="font-mono">stream=false</code>, and for
            images use <code className="font-mono">/v1/vision/*</code> (a string <code className="font-mono">content</code>{" "}
            is required in chat). See troubleshooting below.
          </p>
        </CardContent>
      </Card>

      <CodeTabs
        tabs={[
          { label: "Python (openai SDK)", code: pyOpenAiSdk(base) },
          { label: "Node (openai SDK)", code: nodeOpenAiSdk(base) },
        ]}
      />

      <h3 className="mb-2 mt-4 text-xs font-medium text-muted">OpenAI → gateway model mapping</h3>
      <TableWrap>
        <THead>
          <TR>
            <TH>OpenAI model</TH>
            <TH>Gateway model</TH>
            <TH>Endpoint</TH>
          </TR>
        </THead>
        <TBody>
          {OPENAI_MODEL_MAP.map((m) => (
            <TR key={m.openai}>
              <TD className="text-ink-dim">{m.openai}</TD>
              <TD>
                <code className="rounded bg-bg-base px-1.5 py-0.5 font-mono text-xs text-ink">{m.gateway}</code>
              </TD>
              <TD className="font-mono text-xs text-muted">{m.via}</TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>

      {/* 3. Parameters */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">3. Chat parameters & what they do</h2>
      <TableWrap>
        <THead>
          <TR>
            <TH>Parameter</TH>
            <TH>Type</TH>
            <TH>Default</TH>
            <TH>Effect</TH>
            <TH>Support on this gateway</TH>
          </TR>
        </THead>
        <TBody>
          {CHAT_PARAMS.map((p) => (
            <TR key={p.name}>
              <TD>
                <code className="font-mono text-xs text-ink">{p.name}</code>
              </TD>
              <TD className="whitespace-nowrap text-xs text-muted">{p.type}</TD>
              <TD className="whitespace-nowrap text-xs text-muted">{p.def}</TD>
              <TD className="text-xs text-ink-dim">{p.effect}</TD>
              <TD className="text-xs text-muted">{p.support}</TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>

      {/* 4. All models */}
      <h2 className="mb-1 mt-6 text-sm font-medium text-ink-dim">4. Models — what each one does & how to call it</h2>
      <p className="mb-3 text-xs text-muted">
        Every registered model ({modelItems.length}). Not-installed ones are marked and need an admin to install
        them before use; the example shows the exact request for each.
      </p>
      <ModelReference items={modelItems} />

      {/* 5. OpenAI-compatible endpoints in full */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">5. OpenAI-compatible endpoints</h2>
      <div className="grid gap-3">
        <EndpointDocView ep={modelsEp} base={base} />
        {compatEps.map((ep) => (
          <EndpointDocView key={ep.path} ep={ep} base={base} status={statusByApi.get(ep.apiName) ?? null} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Full per-endpoint reference (vision, image, video, motion, jobs) is on the user{" "}
        <span className="text-ink-dim">How to Use</span> page and in{" "}
        <code className="font-mono text-ink-dim">docs/API.md</code>.
      </p>

      {/* 6. Claude Code */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">6. For Claude Code users</h2>
      <Card className="mb-3">
        <CardContent className="pt-4 text-sm text-ink-dim">
          Paste this block into the new project&apos;s <code className="font-mono text-ink">CLAUDE.md</code> (or{" "}
          <code className="font-mono text-ink">AGENTS.md</code>) so Claude Code generates correct, error-free
          integration code from the start.
        </CardContent>
      </Card>
      <CodeBlock title="CLAUDE.md" code={claudeCodeSnippet(base)} />

      {/* 7. Troubleshooting */}
      <h2 className="mb-2 mt-6 text-sm font-medium text-ink-dim">7. Troubleshooting</h2>
      <TableWrap>
        <THead>
          <TR>
            <TH>Symptom</TH>
            <TH>Cause</TH>
            <TH>Fix</TH>
          </TR>
        </THead>
        <TBody>
          {TROUBLESHOOTING.map((t) => (
            <TR key={t.symptom}>
              <TD className="whitespace-nowrap font-mono text-xs text-ink">{t.symptom}</TD>
              <TD className="text-xs text-muted">{t.cause}</TD>
              <TD className="text-xs text-ink-dim">{t.fix}</TD>
            </TR>
          ))}
        </TBody>
      </TableWrap>
    </>
  );
}
