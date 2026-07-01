#!/usr/bin/env bash
# Start the HY-Motion service (independent venv, localhost only). Pins to one GPU
# via CUDA_VISIBLE_DEVICES (the GPU freed from Ollama). Exposes torch's bundled
# CUDA libs on LD_LIBRARY_PATH like model-service (no-op in the light stub venv).
set -e
cd "$(dirname "$0")"
source .venv/bin/activate

# Which physical GPU this worker uses (default GPU1; GPU0 keeps Ollama/model-service).
export CUDA_VISIBLE_DEVICES="${MOTION_GPU:-1}"

# Use the real HY-Motion model (Phase 0 validated). Text encoders load from ckpts/.
export HYM_REAL="${HYM_REAL:-1}"
export USE_HF_MODELS="${USE_HF_MODELS:-0}"

# HY-Motion checkpoint + SMPL body models (set once installed in Phase 0).
export HY_MOTION_HOME="${HY_MOTION_HOME:-$(pwd)/assets/HY-Motion-1.0}"
export SMPL_MODELS_DIR="${SMPL_MODELS_DIR:-$(pwd)/assets/body_models}"
# Target .pmx for retarget validation (user-provided YYB Miku model).
export HYM_PMX="${HYM_PMX:-$(pwd)/assets/pmx/yyb_miku.pmx}"

NVLIB="$(python - <<'PY'
try:
    import os, glob, nvidia
    base = os.path.dirname(nvidia.__file__)
    dirs = sorted({os.path.dirname(p) for p in glob.glob(os.path.join(base, "*", "lib", "*.so*"))})
    print(":".join(dirs))
except Exception:
    print("")
PY
)"
[ -n "$NVLIB" ] && export LD_LIBRARY_PATH="${NVLIB}:${LD_LIBRARY_PATH:-}"

# Use a dedicated var (NOT the generic PORT, which the gateway sets to 3000 and
# would be inherited when the worker spawns this).
exec uvicorn server:app --host 127.0.0.1 --port "${MOTION_PORT:-8801}"
