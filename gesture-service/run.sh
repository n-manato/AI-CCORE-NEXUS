#!/usr/bin/env bash
# Start the GestureLSM gesture service (audio+text -> SMPL-X joints). Its own venv
# lives in the gesturelsm repo; this launcher lets Nexus (gesture-process.ts) manage
# it like HY-Motion's motion-service. Binds 127.0.0.1:8802 -> only the Nexus gateway
# (with an API key) can reach it, exactly like the other model backends.
set -e
# GPU0 (2026-11-05, KEHAI omni): GPU1 is the Qwen3-Omni Thinker's alone (23.3 of
# 24.5 GB); 2 GB beside it OOM'd the Thinker on its first real forward (GSV,
# 2026-11-02). The default was 1 under a "GPU0" comment. GESTURE_GPU overrides.
export CUDA_VISIBLE_DEVICES="${GESTURE_GPU:-0}"
# GPU0 + CUDA MPS (KEHAI scripts/pcb-mps.sh, 2026-11-05): see model-service/run.sh.
eval "$(/home/ai-ccore/Documents/DEV/KEHAI/scripts/pcb-mps.sh env 2>/dev/null)"
export GESTURE_PORT="${GESTURE_PORT:-8802}"
GLSM_DIR="${GESTURELSM_DIR:-/home/ai-ccore/Documents/DEV/AICCORE-Nexus/stack/gesturelsm}"
cd "$GLSM_DIR"
source .venv/bin/activate
exec python gesture_service.py
