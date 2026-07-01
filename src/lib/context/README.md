# Context management / memory system (`src/lib/context`)

> **Store everything, but never send everything to the model.**
> Full history lives in the DB; each turn the **context builder** sends only a
> budgeted, relevant slice: `system → memory → summary → retrieval → recent → current`.

This solves the real cause of the gateway's context-overflow 502/400: instead of
widening the model's `num_ctx` (VRAM-bound), we control **how much we send**.

## Modules

| File | Responsibility |
|------|----------------|
| `config.ts` | Token budgets per model (max 32768 / reserve 4096 / compact 24000) + section budgets + reduction order |
| `tokens.ts` | Conservative token estimator (no native dep; over-counts slightly, CJK-aware) |
| `store.ts` | Prisma CRUD for conversations/messages/summaries/memory + **SQLite FTS5** index |
| `summarizer.ts` | Rolling, **structured** summary via the resident Ollama model (no 2nd model → no VRAM blow-up) |
| `retriever.ts` | Relevant old messages + memory via FTS5 (LIKE fallback) |
| `budget.ts` | Trim primitives (`truncateToTokens`, `packRecent`) |
| `builder.ts` | Assembles the budgeted `messages[]`; trims in `retrieval → recent → summary → memory` order |
| `compactor.ts` | Auto-compacts when live tokens > threshold; writes `TASK_STATE.md` |
| `task-state.ts` | Snapshots durable project state to repo-root `TASK_STATE.md` (survives compaction) |
| `transparent.ts` | **Stateless** compaction for the OpenAI passthrough (Cline etc.), tool-pair safe |

## Two integration points

**A. Transparent passthrough compaction** — `/v1/chat/completions`.
Opt-in via header `x-nexus-compact: on` (or env `NEXUS_AUTOCOMPACT=on`). When the
incoming `messages[]` would overflow, the older middle is folded into a summary
so the request fits. Off by default; existing clients are untouched.

```bash
curl https://gpu.aiccore-uno.ai/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "x-nexus-compact: on" \
  -d '{"model":"qwen3-coder-next","stream":true,"messages":[ ...huge history... ]}'
```

**B. Stateful, server-managed conversations** — the full system. The server owns
history; the client sends only the new message.

```bash
# create
CID=$(curl -s -X POST https://.../v1/conversations -H "Authorization: Bearer $KEY" \
  -d '{"title":"refactor","model":"qwen3-coder-next"}' | jq -r .id)

# chat (server builds budgeted context, stores, auto-compacts)
curl -X POST https://.../v1/conversations/$CID/messages \
  -H "Authorization: Bearer $KEY" \
  -d '{"content":"continue where we left off","stream":false}'

# inspect full history + summary + live token total
curl https://.../v1/conversations/$CID -H "Authorization: Bearer $KEY"
```

Response headers `x-nexus-context-tokens` / `x-nexus-context-budget` report what
was actually sent vs the budget.

## Tuning

Edit `config.ts` (`DEFAULT_BUDGET`, `MODEL_MAX_CONTEXT`, `REDUCTION_ORDER`).
`MODEL_MAX_CONTEXT` must match the `num_ctx` Ollama actually serves a model at.

## Notes / limits

- Token counts are **estimates** (conservative). Swap `estimateTokens()` for a
  real tokenizer to tighten budgets.
- Retrieval is keyword/FTS5 today; an embeddings tier (e.g. `nomic-embed-text`
  via Ollama) can be added behind `retriever.ts` without touching callers.
- New Prisma models require a dev-server restart to load the regenerated client.
