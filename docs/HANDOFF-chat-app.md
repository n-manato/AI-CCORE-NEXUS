# Handoff — Build a ChatGPT-style app on the 2×RTX 3090 LLM via the Local AI Gateway

Audience: the developer (or a Claude Code session) who will build a chat web app that
talks to the Local AI Gateway, using the **2-GPU LLM** through an API key. Read this
top-to-bottom before writing code.

---

## 0. TL;DR

- Build a chat app whose **backend proxies** to the gateway's OpenAI-compatible
  `POST /v1/chat/completions`. The browser never holds the key.
- Use model **`qwen3-32b-4bit`** (the 2-GPU, highest-quality LLM). For fast responses
  use `qwen3-8b` (always running) or `qwen3-14b`.
- Auth: send the gateway key `lag_...` as `Authorization: Bearer`. Keep it **server-side
  only** (`.env` / `.env.local`, never `NEXT_PUBLIC_`).
- The app runs on the **laptop**; reach the gateway through an **SSH tunnel**
  (`localhost`), not the server's IP.
- **Do not use `stream: true`** (not supported yet). Chat `content` must be a **string**.
- The gateway currently returns **mock** text. Real 2-GPU inference needs a real backend
  wired behind the adapter — **the app code does not change** when that happens.

---

## 1. What you are connecting to

- **Gateway**: the Local AI Gateway (Next.js) running on the server `aiccore`
  (`<server-ip>`), dev server on **port 3000**.
- **Base URL**: `http://localhost:3000/v1` (through a tunnel) or, in production,
  `https://ai-gateway.example.edu/v1`. It must end with `/v1`.
- **OpenAI-compatible** surface you will use:
  - `GET /v1/models` — list selectable model ids
  - `POST /v1/chat/completions` — chat (OpenAI shape)

Full reference: in-app **Admin → API Guide** (`/admin/api-guide`), user **How to Use**,
and `docs/API.md`.

---

## 2. The 2-GPU LLM

| Model id | Quality/Speed | Device plan | Notes |
| --- | --- | --- | --- |
| `qwen3-32b-4bit` | Highest quality | **2GPU Fixed** (GPU0+GPU1) | On Demand; ~22–28 GB; the "2-GPU LLM" |
| `qwen3-14b` | High, single GPU | 1GPU Fixed | On Demand |
| `qwen3-8b` | Fast default | 1GPU Fixed | Always Running |
| `qwen2.5-coder-14b` | Code | 1GPU Fixed | On Demand |

The two RTX 3090s are **two independent 24 GB devices**. `qwen3-32b-4bit` is split across
both because it does not fit one card.

### Admin steps to make the 2-GPU model usable (do this first)

1. Log in as admin → **Model Runtime**.
2. Enable `qwen3-32b-4bit`.
3. Watch the **VRAM forecast**: it is 2GPU Fixed, so with other resident models it can hit
   **Over Limit** (Apply is blocked when either GPU would exceed 24 GB). Disable/trim other
   enabled models until status is Safe/Caution, then **Apply**.
4. Ensure the **LLM Chat** API is `Online` (Admin → APIs).

Until that is done, requests with `model: "qwen3-32b-4bit"` may return `404/503`. Use
`qwen3-8b` while iterating.

---

## 3. Get an API key

1. Log in (the app's user, or admin).
2. **My Access** (or, as admin, **Users & API Access**) → **Reveal** → **Copy**.
3. The user's account must have the **LLM** category enabled (admin sets this in Users &
   API Access) or chat returns `403`.

Treat the key like a password: never commit it, never send it to the browser.

---

## 4. Network: reach the gateway from the laptop

The laptop reaches the server only over **SSH (port 22)**; port 3000 is **not** directly
routable from the laptop. Open a tunnel in the **laptop's own terminal** (PowerShell /
Terminal) and keep it open while developing:

```bash
ssh -L 8080:localhost:3000 ai-ccore@<server-ip>
```

- Left `8080` = a free port on the laptop (Windows often reserves 3000).
- After this, your app's gateway base URL is **`http://localhost:8080/v1`**.
- VSCode users can instead forward port 3000 from the **Ports** panel.

> If you build/run the app **on the server itself**, just use
> `http://localhost:3000/v1` and skip the tunnel.

---

## 5. Architecture (recommended)

```
Browser (chat UI)
   │  POST /api/chat   (your app, no key here)
   ▼
Your app backend (route handler / server)  ── holds LAG_API_KEY ──►  Gateway /v1/chat/completions
   ▲                                                                         │
   └─────────────────────────  reply JSON  ◄────────────────────────────────┘
```

- The key lives only in the backend. The browser calls **your** `/api/chat`, not the
  gateway.
- No streaming yet: return the full reply, then animate it client-side if you want a
  "typing" feel. Do **not** pass `stream: true`.

---

## 6. Minimal backend (Next.js + openai SDK)

`.env.local` (in the new app — never commit):

```bash
LAG_BASE_URL=http://localhost:8080/v1   # tunnel; or http://localhost:3000/v1 on the server
LAG_API_KEY=lag_xxxxxxxxxxxxxxxxxxxxxxxx
LAG_MODEL=qwen3-32b-4bit                 # or qwen3-8b while iterating
```

`app/api/chat/route.ts`:

```ts
import OpenAI from "openai"; // npm i openai

const client = new OpenAI({
  baseURL: process.env.LAG_BASE_URL,
  apiKey: process.env.LAG_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json(); // [{role,content}], content is a STRING
  try {
    const r = await client.chat.completions.create({
      model: process.env.LAG_MODEL ?? "qwen3-8b",
      messages,
      temperature: 0.4,
      max_tokens: 800,
      // stream: false  // keep streaming OFF
    });
    return Response.json({ message: r.choices[0].message });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "gateway error" }, { status: e?.status ?? 502 });
  }
}
```

Minimal client (`app/page.tsx`), keeping the whole history and sending it each turn:

```tsx
"use client";
import { useState } from "react";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "system", content: "You are a helpful lab assistant." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const next = [...messages, { role: "user", content: input } as Msg];
    setMessages(next);
    setInput("");
    setBusy(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next }),
    });
    const data = await res.json();
    if (data.message) setMessages([...next, data.message]);
    setBusy(false);
  }

  return (
    <div>
      {messages.filter((m) => m.role !== "system").map((m, i) => (
        <p key={i}><b>{m.role}:</b> {m.content}</p>
      ))}
      <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
      <button onClick={send} disabled={busy || !input}>Send</button>
    </div>
  );
}
```

### Python / FastAPI alternative

```python
import os
from fastapi import FastAPI
from pydantic import BaseModel
from openai import OpenAI

client = OpenAI(base_url=os.environ["LAG_BASE_URL"], api_key=os.environ["LAG_API_KEY"])
app = FastAPI()

class ChatIn(BaseModel):
    messages: list[dict]

@app.post("/chat")
def chat(body: ChatIn):
    r = client.chat.completions.create(
        model=os.environ.get("LAG_MODEL", "qwen3-8b"),
        messages=body.messages, temperature=0.4, max_tokens=800,
    )
    return {"message": r.choices[0].message.model_dump()}
```

---

## 7. Conversation handling

- The API is **stateless**: send the full `messages` history each request
  (`system` once, then alternating `user`/`assistant`).
- Keep `content` a **string**. (Image input uses `/v1/vision/*`, not chat.)
- Long chats hit the model's context limit — trim or summarize old turns.
- Tune `temperature` (0.2–0.5 for grounded answers, higher for brainstorming) and
  `max_tokens` to cap length/cost.

---

## 8. Errors to handle

| Status | Meaning | What to do in the app |
| --- | --- | --- |
| 401 | bad/missing key | re-reveal & fix `LAG_API_KEY` |
| 403 | user lacks LLM access | admin enables LLM category for the user |
| 404 | model not installed / base URL missing `/v1` | check model id & base URL |
| 429 | throttled | back off and retry |
| 503 | API offline / maintenance / model not enabled | retry later; ask admin to enable |
| 507 | GPU full | retry later; show "busy, try again" |

Show users a friendly message; auto-retry on 503/507 with backoff.

---

## 9. Current limitation (read this)

The gateway's model backend is a **mock** ([`src/lib/backends.ts`](../src/lib/backends.ts)).
`chat/completions` returns placeholder text, not real model output. To get real
`qwen3-32b-4bit` answers, wire a real backend behind the adapter — e.g. **vLLM** serving
the 32B 4-bit model with **tensor parallelism across the two GPUs**
(`--tensor-parallel-size 2`) — and have `activeBackend` call it. **Your chat app does not
change**: same base URL, same key, same request shape.

---

## 10. Pre-flight checklist

- [ ] App user has **LLM access** enabled; API key revealed and put in the app's `.env`.
- [ ] (For the 2-GPU model) admin **enabled `qwen3-32b-4bit`** in Model Runtime with the
      VRAM forecast not Over Limit, and **LLM Chat** is `Online`. Otherwise use `qwen3-8b`.
- [ ] **SSH tunnel up**; app `LAG_BASE_URL=http://localhost:8080/v1`.
- [ ] Backend proxy works: `curl -s http://localhost:8080/v1/models -H "Authorization: Bearer $LAG_API_KEY"` returns models; your `/api/chat` returns a reply.
- [ ] Key is **server-side only**; `stream:false`; `content` is a string; errors handled.

---

## 11. Quick sanity test (before building UI)

```bash
# with the tunnel open and the key exported on the laptop
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"Say hi"}]}'
```

A `200` with a `choices[0].message.content` field means you are wired up correctly (the
text will be mock until a real backend is connected).
