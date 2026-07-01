# TASK_STATE

_Source of truth for project state. Auto-overwritten by the context system
(`src/lib/context/task-state.ts`) before each compaction; edit freely between runs._

## Current Goal
Stop KV-cache / context overflow on the local Ollama gateway by managing what is
sent to the model — "store everything, send only a budgeted, relevant slice."

## Completed
- Diagnosed the 502s: gateway flattened every Ollama non-2xx into `502 backend_error`,
  hiding context-overflow (400) and chat-template (500) failures.
- Gateway now classifies upstream errors (ctx overflow→400, template→400, gpu→507,
  timeout→504) and passes Ollama's real message through (`src/lib/gateway.ts`,
  `src/lib/ollama.ts`, `src/app/v1/chat/completions/route.ts`).
- Durable error log at `logs/gateway-errors.log` (`src/lib/gateway-log.ts`).
- Built the context-management system (`src/lib/context/*`): storage, structured
  rolling summarizer, FTS5 retrieval, token budget, context builder, auto-compactor,
  TASK_STATE writer, transparent passthrough compaction.
- Prisma models added: Conversation, Message, ConversationSummary, MemoryItem (+FTS5).
- New endpoints: `POST /v1/conversations`, `GET/DELETE /v1/conversations/:id`,
  `POST /v1/conversations/:id/messages`. Opt-in header `x-nexus-compact` on
  `/v1/chat/completions`.
- Verified the engine end-to-end (35.4k→17.7k tokens compacted, budget respected).

## In Progress
- (none active)

## Important Decisions
- Engine is layer-agnostic; integrated at both the passthrough (A, opt-in) and a
  new stateful conversation API (B).
- Token counts are conservative estimates (no native tokenizer dep yet).
- Retrieval starts at SQLite FTS5; embeddings tier deferred.
- Compaction reuses the resident model (no 2nd model → no VRAM blow-up).

## User Constraints
- 2×24GB GPUs (~48GB), one ~40GB model pinned (keep_alive=-1) → ~4GB free.
- `sudo` is password-gated; Ollama service changes must be handed to the user.
- Don't disrupt the running `next dev` gateway without asking.

## Edited Files
- `prisma/schema.prisma`, `src/lib/gateway.ts`, `src/lib/ollama.ts`,
  `src/lib/gateway-log.ts`, `src/app/v1/chat/completions/route.ts`,
  `src/lib/context/*` (config, tokens, store, retriever, summarizer, budget,
  builder, compactor, task-state, transparent, README),
  `src/app/v1/conversations/**`, `scripts/ollama-raise-context.sh`, `.gitignore`.

## Current Errors
- (none) — typecheck clean.

## Next Steps
- Restart `next dev` so the regenerated Prisma client + new routes load, then
  HTTP-test `/v1/conversations`.
- Optional: apply `scripts/ollama-raise-context.sh` (needs sudo) to widen num_ctx.
- Optional: add an embeddings retrieval tier (`nomic-embed-text` via Ollama).

## Do-Not-Forget
- The gateway is a stateless OpenAI passthrough; clients (Cline) own their history.
  Transparent compaction (A) is OFF by default so it never interferes with them.
