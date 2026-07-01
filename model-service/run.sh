#!/usr/bin/env bash
# Start the model sidecar. Exposes torch's bundled CUDA libs (cuDNN/cuBLAS) on
# LD_LIBRARY_PATH so faster-whisper (ctranslate2) can use the GPU.
set -e
cd "$(dirname "$0")"
source .venv/bin/activate

NVLIB="$(python - <<'PY'
import os, glob, nvidia
base = os.path.dirname(nvidia.__file__)
dirs = sorted({os.path.dirname(p) for p in glob.glob(os.path.join(base, "*", "lib", "*.so*"))})
print(":".join(dirs))
PY
)"
export LD_LIBRARY_PATH="${NVLIB}:${LD_LIBRARY_PATH:-}"

exec uvicorn app:app --host 127.0.0.1 --port "${PORT:-8000}"
