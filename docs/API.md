# Local AI Gateway — Developer API Guide

How to build an app against the Local AI Gateway, in the style of the OpenAI API.
This is the full reference (all endpoints). In the app, the **How to Use** page shows
the same content filtered to the APIs your account is allowed to use.

> The model backends are currently **mock**. Auth, access control, usage logging,
> jobs, and error handling are real; response bodies from models are placeholder data.

---

## 1. Authentication

Every request authenticates with a Bearer API key:

```
Authorization: Bearer <API_KEY>
```

- Get your key from the app: **My Access** (or **Users & API Access** for admins) → Reveal / Copy.
- The key must **never** appear in the URL.
- Repeated invalid keys from one IP are throttled (HTTP 429).
- Store it in an environment variable:

```bash
export LAG_API_KEY="lag_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## 2. Base URL

```
https://ai-gateway.example.edu/v1     # production (set NEXT_PUBLIC_GATEWAY_BASE_URL)
http://localhost:3000/v1              # local development
```

All paths below are relative to the host and begin with `/v1`.

## Migrating from OpenAI (drop-in)

The gateway is OpenAI-compatible, so keep the official `openai` SDK and change only
the base URL + key (+ model id).

```bash
# .env — minimal migration (the openai SDK auto-reads these)
OPENAI_BASE_URL=https://ai-gateway.example.edu/v1
OPENAI_API_KEY=lag_xxxxxxxxxxxxxxxxxxxxxxxx
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/v1", api_key="lag_xxx")
r = client.chat.completions.create(
    model="qwen3-8b",                       # gateway model id, not "gpt-4o"
    messages=[{"role": "user", "content": "Hello"}],
    temperature=0.3, max_tokens=300,        # extra params are accepted
)
print(r.choices[0].message.content)
```

```js
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:3000/v1", apiKey: process.env.LAG_API_KEY });
const r = await client.chat.completions.create({
  model: "qwen3-8b",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(r.choices[0].message.content);
```

**Two rules to avoid errors:**

- **Do not set `stream: true`** — the gateway returns a single JSON object, not an SSE
  stream, so SDK streaming parsers will fail. Leave streaming off.
- **Chat image input.** `/v1/chat/completions` preserves OpenAI image content arrays;
  `/v1/responses` accepts `input_image` with a Base64 Data URL or a public HTTP(S)
  image URL. Remote images are fetched by the gateway, validated, and sent to the
  configured vision-capable Ollama model.

Unknown OpenAI params (`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`,
`seed`, `n`, `stop`) are accepted and never error; they apply once a real backend is
connected (the mock ignores them).

| OpenAI model | Gateway model | Endpoint |
| --- | --- | --- |
| gpt-4o-mini / gpt-3.5-turbo | `qwen3-8b` | /v1/chat/completions |
| gpt-4o / gpt-4.1 | `qwen3-14b` / `qwen3-32b-4bit` | /v1/chat/completions |
| gpt-4o (coding) | `qwen2.5-coder-14b` | /v1/chat/completions |
| gpt-4o vision | `qwen3.6-27b` | /v1/responses (`input_image`) or /v1/vision/chat (file upload) |
| tts-1 / tts-1-hd | `kokoro-82m` / `gpt-sovits` | /v1/audio/speech |
| whisper-1 | `faster-whisper-medium` / `large-v3` | /v1/audio/transcriptions |
| dall-e-3 / gpt-image-1 | `flux-schnell` / `flux-dev` | /v1/images/generations (Job) |

The in-app admin page **API Guide** (under Audit Logs) has the same guide plus a
parameter-effects table, a live model catalog, troubleshooting, and a ready-to-paste
`CLAUDE.md` block for Claude Code users.

## 3. Request gate

Each gateway request passes, in order:

1. **Authentication** — valid, active key → else `401`.
2. **Maintenance** — if Maintenance Mode is On, normal users get `503 maintenance` (admins bypass).
3. **Category access** — your account must be allowed the endpoint's category → else `403`.
4. **API status** — the API must be `Online`; `Not Installed` → `404`, otherwise → `503`.

Categories: `LLM`, `TTS`, `STT`, `Vision`, `Image`, `Video`, `Motion`.

## 4. Choosing a model

```bash
curl http://localhost:3000/v1/models -H "Authorization: Bearer $LAG_API_KEY"
```

`GET /v1/models` returns the **installed** models your key can use (filtered by your
category access; admins see the whole catalog). Pass a returned `id` in the request
body's `model` field.

```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen3-8b", "object": "model", "owned_by": "local",
      "category": "LLM", "function": "Chat fast", "backend": "vLLM",
      "device_plan": "1GPU Fixed", "status": "Running",
      "startup_policy": "Always Running",
      "estimated_vram_gb": { "min": 14, "max": 16 }
    }
  ]
}
```

Guidance: use a **fast** model for interactive work, a **quality** model for harder
tasks. Large models may be `2GPU Fixed` or run as queued **Jobs**. A model that is not
already running may be slower on the first call (cold start).

### Model catalog (seed defaults)

> "Device Rule" is the model's intended placement (`default_device_rule`). For an
> installed model this is also its live Device Plan; a not-installed model reports a
> live Device Plan of "Not Installed" in the app and `GET /v1/models` until installed.

| Category | Model id | Function | Backend | Installed | Device Rule | Est. VRAM |
| --- | --- | --- | --- | --- | --- | --- |
| LLM | `qwen3-8b` | Chat fast | vLLM | yes | 1GPU Fixed | 14–16 GB |
| LLM | `qwen3-14b` | Chat quality | vLLM | yes | 1GPU Fixed | 18–20 GB |
| LLM | `qwen3-32b-4bit` | Chat quality | vLLM | yes | 2GPU Fixed | 22–28 GB |
| LLM | `qwen2.5-coder-14b` | Code fast | vLLM | yes | 1GPU Fixed | 18–20 GB |
| LLM | `qwen2.5-coder-32b` | Code quality | vLLM | no | 2GPU Fixed | 26–30 GB |
| LLM | `gemma-3-27b` | Chat quality | vLLM | no | 2GPU Fixed | 24–28 GB |
| TTS | `kokoro-82m` | TTS fast | Kokoro | yes | CPU Fixed | 0–1 GB |
| TTS | `gpt-sovits` | TTS quality | GPT-SoVITS | yes | 1GPU Fixed | 3–4 GB |
| TTS | `xtts-v2` | TTS quality | Coqui | no | 1GPU Fixed | 3–4 GB |
| STT | `faster-whisper-medium` | STT fast | faster-whisper | yes | 1GPU Fixed | 2–3 GB |
| STT | `faster-whisper-large-v3` | STT quality | faster-whisper | yes | 1GPU Fixed | 5–6 GB |
| STT | `deepfilternet` | Speech enhancement | DeepFilterNet | yes | CPU Fixed | 0–1 GB |
| Vision | `qwen2.5-vl-7b` | Vision QA fast | vLLM | yes | 1GPU Fixed | 14–16 GB |
| Vision | `qwen2.5-vl-32b` | Vision QA quality | vLLM | no | 2GPU Fixed | 28–34 GB |
| LLM/Vision | `qwen3.6-27b` | Reasoning + vision | Ollama | yes | 2GPU | 29.5–31 GB |
| Vision | `paddleocr` | OCR fast | PaddleOCR | yes | CPU Fixed | 0–2 GB |
| Vision | `yolo11s` | Object detection | Ultralytics | yes | 1GPU Fixed | 1–2 GB |
| Vision | `sam2` | Segmentation | SAM2 | no | 1GPU Fixed | 6–8 GB |
| Vision | `rtmpose` | Pose estimation | MMPose | yes | 1GPU Fixed | 1–2 GB |
| Vision | `depth-anything-v2` | Depth estimation | DepthAnything | yes | 1GPU Fixed | 1–2 GB |
| Image | `flux-schnell` | Image gen fast | ComfyUI | no | 1GPU Fixed | 12–16 GB |
| Image | `flux-dev` | Image gen quality | ComfyUI | no | 1GPU Fixed | 20–24 GB |
| Image | `real-esrgan` | Image enhancement | Real-ESRGAN | yes | 1GPU Fixed | 1–2 GB |
| Image | `rembg` | Background removal | rembg | yes | CPU Fixed | 0–1 GB |
| Video | `video-understanding-vl` | Video understanding | vLLM | no | 1GPU Fixed | 16–20 GB |
| Video | `llava-onevision` | Video understanding | vLLM | no | 2GPU Fixed | 26–32 GB |
| Video | `musetalk` | Lip sync | MuseTalk | no | 1GPU Fixed | 6–8 GB |
| Motion | `rule-motion` | Motion gen fast | Custom | yes | CPU Fixed | 0–1 GB |
| Motion | `motiongpt` | Motion gen quality | MotionGPT | no | 1GPU Fixed | 8–10 GB |
| Motion | `robot-controller` | Robot motion | Custom | yes | CPU Fixed | 0 GB |

## 5. Operation modes

- **Real-time** — request/response (chat, STT, detection, pose, robot motion).
- **Sync** — normal request/response in seconds (RAG, TTS, OCR, depth, enhance).
- **Job** — heavy work; returns a `job_id`. Poll `GET /v1/jobs/{job_id}` (image/video).

## 6. Endpoints

| Method | Path | Category | Mode | Status (seed) |
| --- | --- | --- | --- | --- |
| GET | `/v1/models` | Core | — | — |
| GET | `/v1/jobs/{job_id}` | Core | — | — |
| POST | `/v1/jobs/{job_id}/cancel` | Core | — | — |
| POST | `/v1/chat/completions` | LLM | Real-time | Online |
| POST | `/v1/responses` | LLM/Vision | Real-time | Online |
| POST | `/v1/rag/query` | LLM | Sync | Online |
| POST | `/v1/audio/speech` | TTS | Sync | Online |
| POST | `/v1/audio/transcriptions` | STT | Real-time | Online |
| POST | `/v1/audio/enhance` | STT | Sync | Online |
| POST | `/v1/audio/voice-conversion` | STT | Sync | Offline |
| POST | `/v1/vision/chat` | Vision | Sync | Offline |
| POST | `/v1/vision/ocr` | Vision | Sync | Online |
| POST | `/v1/vision/detect` | Vision | Real-time | Online |
| POST | `/v1/vision/segment` | Vision | Job | Not Installed |
| POST | `/v1/vision/pose` | Vision | Real-time | Online |
| POST | `/v1/vision/depth` | Vision | Sync | Online |
| POST | `/v1/images/generations` | Image | Job | Not Installed |
| POST | `/v1/images/enhance` | Image | Sync | Online |
| POST | `/v1/images/remove-background` | Image | Sync | Online |
| POST | `/v1/video/understanding/jobs` | Video | Job | Not Installed |
| POST | `/v1/video/lip-sync/jobs` | Video | Job | Not Installed |
| POST | `/v1/motion/generate` | Motion | Sync | Disabled |
| POST | `/v1/robot-motion/commands` | Motion | Real-time | Error |
| POST | `/v1/3d/generations` | 3D | Sync | On Demand |

Endpoints with a dedicated handler: `models`, `chat/completions`, `rag/query`,
`audio/speech`, `audio/transcriptions`, `images/generations`, `3d/generations`,
`jobs/{id}`, `jobs/{id}/cancel`. The rest are mock skeletons that run the same gate
and return a mock body (or create a Job for Job-mode APIs).

## 7. Examples

### Chat completions (LLM)

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"Hello from the lab"}]}'
```

```python
import os, requests

API_KEY = os.environ["LAG_API_KEY"]
resp = requests.post(
    "http://localhost:3000/v1/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={"model": "qwen3-8b", "messages": [{"role": "user", "content": "Hello"}]},
)
print(resp.json())
```

```js
const res = await fetch("http://localhost:3000/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.LAG_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "qwen3-8b",
    messages: [{ role: "user", content: "Hello" }],
  }),
});
console.log(await res.json());
```

### Text to speech (TTS) — binary response

```bash
curl http://localhost:3000/v1/audio/speech \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kokoro-82m","input":"Hello from the lab","format":"wav"}' \
  --output speech.wav
```

### Transcription (STT) — multipart upload

```bash
curl http://localhost:3000/v1/audio/transcriptions \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -F model=faster-whisper-medium \
  -F file=@audio.wav
```

```python
import os, requests
API_KEY = os.environ["LAG_API_KEY"]
resp = requests.post(
    "http://localhost:3000/v1/audio/transcriptions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    data={"model": "faster-whisper-medium"},
    files={"file": open("audio.wav", "rb")},
)
print(resp.json())
```

> The backend is mock: the handler validates that a `file` is present (missing file →
> `400 bad_request`) and returns placeholder text. The audio is not transcribed or stored.

### Image generation (Job) — create then poll

```bash
# Create the job (returns a job_id)
curl http://localhost:3000/v1/images/generations \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"flux-schnell","prompt":"a neon cyberpunk city","size":"1024x1024","n":1}'

# Poll the job
curl http://localhost:3000/v1/jobs/JOB_ID -H "Authorization: Bearer $LAG_API_KEY"

# Cancel the job
curl -X POST http://localhost:3000/v1/jobs/JOB_ID/cancel -H "Authorization: Bearer $LAG_API_KEY"
```

> `Image Generation` is `Not Installed` in seed data, so it returns `404` until an admin
> installs/enables it. Once Online, the create call returns `202 { "job_id", "status" }`.

### Image to 3D (TRELLIS.2) — multipart upload, binary GLB response

Turn a **single** image into a PBR-textured 3D asset. The response body **is** the
binary `.glb` (`Content-Type: model/gltf-binary`) — write it straight to a file with
`-o`. This is `Sync`, so the request blocks for ~seconds-to-a-minute until the model
is done (no job polling).

```bash
curl -X POST https://gpu.aiccore-uno.ai/v1/3d/generations \
  -H "Authorization: Bearer $LAG_API_KEY" \
  -F image=@photo.png \
  -F resolution=512 \
  -o model.glb
```

```python
import os, requests

API_KEY = os.environ["LAG_API_KEY"]
resp = requests.post(
    "https://gpu.aiccore-uno.ai/v1/3d/generations",
    headers={"Authorization": f"Bearer {API_KEY}"},
    data={"resolution": "512"},
    files={"image": open("photo.png", "rb")},
)
with open("model.glb", "wb") as f:
    f.write(resp.content)
```

Fields: `image` (required, png/jpg), `resolution` (`512` | `1024` | `1536`, default
`512`), `seed` (int, default `42`), `texture_size` (int, default `2048`).

> **One input image only** — TRELLIS.2 does not fuse multiple views. On a 24 GB GPU,
> `512` (~36s) and `1024` (~118s in offload mode) both work; `1536` exceeds 24 GB and
> OOMs during remeshing (needs a >24 GB card). Backend runs at `maxConcurrent 1`, so
> overlapping callers queue or receive `429`.

## 8. Errors

All errors use:

```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```

| HTTP | code | When |
| --- | --- | --- |
| 400 | `bad_request` | Body failed validation. |
| 401 | `invalid_api_key` | Missing / disabled / unknown key. |
| 403 | `access_denied` | No access to the category, or account disabled. |
| 404 | `not_found` | Unknown endpoint, or API Not Installed. |
| 408 | `timeout` | Request timed out. |
| 409 | `conflict` | Conflicts with current state (e.g. cancel a finished job). |
| 429 | `rate_limited` | Too many invalid key attempts / throttling. |
| 500 | `internal` | Unexpected server error. |
| 502 | `backend_error` | Model backend failed. |
| 503 | `unavailable` | API Offline / Error / Disabled. |
| 503 | `maintenance` | Maintenance Mode on (normal users). |
| 504 | `backend_timeout` | Backend did not respond in time. |
| 507 | `gpu_full` | No GPU capacity. |

## 9. Limits & queueing

- No total request cap; concurrency is limited per API type (see the spec / Model Runtime page).
- Heavy jobs usually run one at a time; long-waiting jobs gain priority over time.
- When the GPU is Busy/Full you may see slower responses or `507`.
