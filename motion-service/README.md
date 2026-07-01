# motion-service (HY-Motion 1.0 → MMD .vmd)

Independent localhost FastAPI backend behind the AICCORE Nexus gateway. Turns
English text into an MMD body-motion `.vmd` (text → SMPL motion → retarget → `.vmd`).
Clients (Cline / PC-A VTuber) reach it ONLY through the gateway `/v1/motion/*` —
this port is `127.0.0.1` only, exactly like Ollama and model-service.

Pipeline: `hy_motion_runner` (HY-Motion) → `smpl_to_mmd` (numeric retarget) →
`vmd_writer` (.vmd bytes). `pool` keeps a warm clip per emotion for instant serving.

## Run
```bash
cd motion-service
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./run.sh                      # 127.0.0.1:8801  (CUDA_VISIBLE_DEVICES=MOTION_GPU, default 1)
```

## Endpoints (internal; gateway proxies these)
- `GET  /healthz`            → `{ok, capabilities:{motion}, loaded:{hy_motion}, stub, cuda, gpu, pool}`
- `POST /generate`          `{prompt?, emotion?, duration?<=5, seed?}` → `.vmd` (octet-stream)
- `GET  /pool/{emotion}`    → instant warm `.vmd`, or 503 if not warm yet
- `GET  /pool`              → per-emotion warm counts

Emotions: `neutral, happy, sad, thinking, surprised, angry, shy` (see `prompts.py`,
shared with PC-A).

## Status
**STUB mode** until HY-Motion 1.0 is installed: `hy_motion_runner` returns a
hand-authored wave so the full gateway→.vmd→Miku path is testable now. Real model
wiring + the SMPL retarget calibration are the Phase 0 tasks:

1. Clone `Tencent-Hunyuan/HY-Motion-1.0` → `assets/HY-Motion-1.0`; weights from HF
   `tencent/HY-Motion-1.0`; SMPL/SMPL-X body models (license-gated) → `assets/body_models`.
   `pip install torch (cu124) smplx huggingface_hub` (+ pytorch3d if inference needs it).
2. Fill in `hy_motion_runner._load_real` / `_generate_real` (return
   `{"format":"smpl","poses","trans","fps"}`); record the REAL NPZ keys/shapes/fps.
3. Calibrate `smpl_to_mmd.QUAT_AXIS_SIGN` / rest-pose handling against the YYB Miku
   `.pmx` (set `HYM_PMX`) until limbs are correct (T-pose↔A-pose, handedness, Y-up).
