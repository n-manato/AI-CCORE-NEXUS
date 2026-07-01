# Local AI Gateway

Internal AI API management for a shared research-lab AI server with **2 x RTX 3090**
(treated as two independent **24GB** GPUs: GPU 0 + GPU 1, never one automatic 48GB device).

It provides one gateway to share local AI APIs (LLM, TTS, STT, Vision, Image, Video,
Motion), with role-based access, API keys, usage tracking, GPU/queue status,
maintenance mode, admin audit logs, model runtime control, and a live per-GPU VRAM
forecast.

> Real model inference is **not** wired up. Backends use clean adapter interfaces with
> mock implementations, and GPU/system metrics use a real adapter (`nvidia-smi`, host
> RAM/CPU/disk) that falls back to mock data when hardware telemetry is unavailable.

---

## Tech stack

- **Next.js 15** (App Router) + **React 18** + **TypeScript**
- **Tailwind CSS** (dark, futuristic dashboard theme) + **Recharts** + **Lucide** icons + **Framer Motion**
- **Prisma** ORM with **SQLite** for local dev (portable to PostgreSQL — see below)
- Auth: email + password (**bcrypt** hashes) with signed **JWT** session cookies (**jose**)
- API keys: stored **AES-256-GCM encrypted** + SHA-256 hashed for lookup

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env
#    then generate a real 32-byte key for API_KEY_ENC_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    (a working dev .env is already included for local use)

# 3. Create the SQLite DB, generate the client, and seed demo data
npm run setup

# 4. Run the dev server
npm run dev
# open http://localhost:3000
```

> Run locally over **HTTP via `npm run dev`**. In production (`npm start`) session
> cookies are marked `Secure`, so the app must be served over **HTTPS** (and used over
> VPN). This is intentional.

### Demo accounts (local development only)

| Role  | Email            | Password     | Access                         |
| ----- | ---------------- | ------------ | ------------------------------ |
| Admin | admin@lab.local  | admin12345   | All categories                 |
| User  | user@lab.local   | user12345    | LLM, TTS, STT                  |

Two extra demo users (`mina@lab.local`, `leo@lab.local`, password `user12345`) add
variety to usage charts and access examples. Passwords come from `.env`
(`SEED_*`). **Change them for anything beyond local development.**

## Scripts

| Script             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `npm run dev`      | Start the dev server (HTTP, hot reload)            |
| `npm run build`    | Production build (`prisma generate` + `next build`)|
| `npm start`        | Start the production server (needs HTTPS)          |
| `npm run setup`    | `prisma generate` + `db push` + seed               |
| `npm run db:push`  | Apply the Prisma schema to the DB                  |
| `npm run db:seed`  | (Re)seed demo data                                 |
| `npm run typecheck`| `tsc --noEmit`                                     |
| `npm run lint`     | ESLint (next/core-web-vitals)                      |

## Environment variables

See [.env.example](.env.example). Key ones:

- `DATABASE_URL` — SQLite path for dev (`file:./dev.db`).
- `AUTH_SECRET` — signs session JWTs.
- `SESSION_TTL_SECONDS` — session lifetime (default 8h).
- `API_KEY_ENC_KEY` — **64-char hex (32 bytes)** key for AES-256-GCM API-key encryption. Comes from the environment, never the database.
- `CORS_ALLOWED_ORIGINS` — comma-separated allowed origins for the `/v1` API.
- `NEXT_PUBLIC_GATEWAY_BASE_URL` — base URL shown in "How to Use" docs.
- `SEED_*` — demo account credentials.

## Routes

**Public:** `/login`

**Admin:** `/admin/dashboard`, `/admin/users-access`, `/admin/apis`, `/admin/usage`,
`/admin/model-runtime`, `/admin/audit-logs`

**User:** `/user/my-access`, `/user/my-usage`, `/user/how-to-use`

Role-based routing is enforced in [src/middleware.ts](src/middleware.ts) and re-checked
in each layout/server action against the database.

## Gateway API (`/v1`)

OpenAI-style, `Authorization: Bearer <API_KEY>`. Every request runs the gate:
**auth → maintenance → category access → API status**.

Fully implemented (mock backend): `GET /v1/models`, `POST /v1/chat/completions`,
`POST /v1/audio/speech`, `POST /v1/audio/transcriptions`, `POST /v1/rag/query`,
`POST /v1/images/generations` (Job), `GET /v1/jobs/{id}`, `POST /v1/jobs/{id}/cancel`.

All other declared endpoints (`/v1/vision/*`, `/v1/images/*`, `/v1/video/*`,
`/v1/motion/*`, `/v1/audio/enhance`, `/v1/audio/voice-conversion`, `/v1/robot-motion/*`)
are handled by a catch-all skeleton ([src/app/v1/[...slug]/route.ts](src/app/v1/%5B...slug%5D/route.ts))
that runs the same gate and returns a mock response (or creates a Job for Job-mode APIs).

Example:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"Hello"}]}'
```

Reveal a key in the UI (My Access / Users & API Access) to get a real value to test with.

**Full developer guide:** [docs/API.md](docs/API.md) — authentication, model selection,
every endpoint with cURL/Python/Node examples, and the error reference. The in-app
**How to Use** page shows the same guide filtered to the APIs your account may use.
`GET /v1/models` returns the installed models your key can select (by category access).

## Access result logic

Implemented in [src/lib/access.ts](src/lib/access.ts), evaluated in order:
**access → API status → GPU status**.

| Condition                                        | Result                       |
| ------------------------------------------------ | ---------------------------- |
| Access Disabled                                  | Not allowed                  |
| API Not Installed                                | Not available                |
| API Offline / Error / Disabled                   | Temporarily unavailable      |
| GPU Offline                                       | GPU unavailable              |
| Online + GPU Full                                | Very busy, try later         |
| Online + GPU Busy                                | Available, but may be slow   |
| Online + GPU Available                           | Available                    |

## Model Runtime & VRAM planning

[/admin/model-runtime](src/app/admin/model-runtime/page.tsx) lets admins edit
**Startup Policy, Runtime Type, Size Class, Enable, Max Concurrent**. **Device Plan is
read-only and system-calculated** (CPU Fixed / 1GPU Fixed / 2GPU Fixed / Disabled / Not
Installed) with a badge + reason.

The **VRAM forecast** ([src/lib/vram.ts](src/lib/vram.ts)) computes worst-case predicted
VRAM per GPU and total, and a status: **Safe / Caution / Warning / Critical / Over Limit /
Invalid Combination**. The meter updates live as you edit.

Key rule (enforced both client- and server-side): the two cards are **independent 24GB
devices**. If GPU 0 **or** GPU 1 is predicted to exceed 24GB, status is **Over Limit** and
**Apply is blocked — even if the 48GB total looks fine**. A `2GPU Fixed` model without
multi-GPU backend support yields **Invalid Combination** (also blocked). **Critical**
(≥95% on a GPU) requires confirmation. Successful Apply persists config, writes a VRAM
forecast snapshot, and an audit log.

## Security notes

- Passwords stored as bcrypt hashes; sessions are signed JWTs in `httpOnly` cookies that expire.
- API keys are AES-256-GCM encrypted at rest (key from env) and SHA-256 hashed for lookup. **Full keys, passwords, prompts, and input files are never logged.**
- Reveal / copy / regenerate / disable / access changes write to **admin audit logs** (metadata only). Regenerating a key invalidates the old one immediately.
- Repeated invalid `/v1` API-key attempts are throttled per IP (in-memory; back with Redis for production).
- CORS is limited to `CORS_ALLOWED_ORIGINS`. Use over VPN; HTTPS required in production.

## What is real vs. mock

- **Real:** auth, sessions, RBAC, API keys (encrypt/hash/reveal/regenerate/disable), access decision engine, usage logging, audit logs, maintenance behavior, job records, model registry/runtime config, VRAM forecast + Apply validation, host RAM/CPU/disk metrics, GPU telemetry **if** `nvidia-smi` works.
- **Mock:** model inference (`src/lib/backends.ts`), and GPU metrics when `nvidia-smi` is unavailable (e.g. driver mismatch) — clearly labeled "mock" in the dashboard.

## Moving to PostgreSQL

The schema avoids SQLite-only features. To switch: set the Prisma datasource
`provider = "postgresql"`, point `DATABASE_URL` at Postgres, then run
`prisma migrate dev`. Status-like columns are plain strings whose allowed values live in
[src/lib/constants.ts](src/lib/constants.ts).

## Project layout

```
prisma/schema.prisma     # all tables (users, api_keys, api_access, api_status,
                         # usage_logs, jobs, system_settings, admin_audit_logs,
                         # model_registry, model_runtime_config/state, vram_forecast_snapshots)
prisma/seed.ts           # demo data (self-contained, runs via tsx)
src/lib/                 # db, auth, jwt, crypto, apikey, access, vram, gpu, metrics,
                         # gateway, runtime, queries, audit, constants
src/app/v1/              # OpenAI-style gateway endpoints
src/app/api/             # management API (auth, users, keys, apis, runtime, maintenance, jobs, queue)
src/app/admin/, /user/   # role-based pages
src/components/          # ui/, layout/, charts/, dashboard/, runtime/, users/, apis/, admin/
```

## Verification

`npm run typecheck`, `npm run lint`, and `npm run build` all pass. Smoke-tested:
login, key reveal, `/v1/models`, `/v1/chat/completions`, `/v1/audio/speech`, access
denial (403), missing key (401), maintenance behavior (user 503 / admin bypass), and
VRAM Over-Limit Apply blocking.
