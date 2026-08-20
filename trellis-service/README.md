# trellis-service — TRELLIS.2 image → 3D (GLB)

Independent localhost FastAPI backend for [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2)
(`TRELLIS.2-4B`, single image → PBR-textured GLB). The AICCORE-Nexus gateway
proxies `POST /v1/3d/generations` here and returns the `.glb` to clients. Bound to
`127.0.0.1:8811`; nothing on the LAN talks to this port directly. **Not** served via
Ollama — it is a dedicated Python GPU service, like motion-service / gesture-service.

## Why its own conda env (not a venv)

TRELLIS.2 needs compiled CUDA extensions (flash-attn, nvdiffrast, nvdiffrec, o-voxel,
flexgemm, cumesh) and CUDA 12.4 / PyTorch 2.6. Its own `setup.sh` builds these into a
`trellis2` conda env — a plain venv (as used by the other sidecars) can't build them.

## Install (once, on the GPU server)

```bash
cd trellis-service
./install_trellis.sh          # clones TRELLIS.2, runs setup.sh, adds FastAPI deps
```

Prereqs: Linux, NVIDIA GPU **≥ 24 GB VRAM**, CUDA 12.4, `conda` on PATH.

### Hugging Face gated dependency (REQUIRED)

The pipeline's image encoder is **`facebook/dinov3-vitl16-pretrain-lvd1689m`**, a
**gated** HF repo. Without access the pipeline load fails with a 401 and the service
stays in stub mode. One-time, on the server:

1. Accept the license at <https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m> (needs an HF account).
2. Authenticate so `from_pretrained` can fetch it — either:
   - `conda activate trellis2 && huggingface-cli login`  (writes `~/.cache/huggingface/token`, picked up automatically), **or**
   - export `HF_TOKEN=hf_...` (a read token) in the service environment.

The `TRELLIS.2-4B` weights themselves are public; only the DINOv3 encoder is gated.

## Run

```bash
./run.sh                       # 127.0.0.1:8811
```

Env knobs (all optional):

| Var | Default | Meaning |
| --- | --- | --- |
| `TRELLIS_GPU` | `0` | Physical GPU index (`CUDA_VISIBLE_DEVICES`). |
| `TRELLIS_RESOLUTION` | `512` | `512` / `1024` / `1536`. 512 keeps peak < 24 GB on a 3090; raise only on a bigger card. |
| `TRELLIS_MODEL` | `microsoft/TRELLIS.2-4B` | HF weights id. |
| `TRELLIS_PORT` | `8811` | Bind port. |
| `TRELLIS_REPO` | `./TRELLIS.2` | Path to the cloned checkout. |

## API

- `GET /healthz` → `{ ok, capabilities:{image_to_3d}, loaded:{trellis2}, stub, cuda, gpu, model, resolutions }`
- `POST /generate` (multipart) → `.glb` bytes (`model/gltf-binary`)
  - `image` (file, required), `resolution` (512/1024/1536), `seed`, `decimation_target`, `texture_size`

**Stub mode:** before weights are installed, the port still answers `/healthz`
(`stub:true`) and `/generate` returns `501` — so the gateway lists the model and
shows it Offline instead of the port being dead. Install, then restart.

## Notes

- One request at a time (the pipeline + GLB extraction own the whole GPU); the
  gateway also enforces `maxConcurrent=1` and a VRAM lease, so concurrent callers
  queue/-429 instead of OOMing.
- Peak VRAM is highest during GLB extraction/rendering (~24–30 GB at high res).
  Keep `resolution=512` on a 24 GB card.
