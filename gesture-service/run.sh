#!/usr/bin/env bash
# Start the GestureLSM gesture service (audio+text -> SMPL-X joints). Its own venv
# lives in the gesturelsm repo; this launcher lets Nexus (gesture-process.ts) manage
# it like HY-Motion's motion-service. Binds 127.0.0.1:8802 -> only the Nexus gateway
# (with an API key) can reach it, exactly like the other model backends.
set -e
export CUDA_VISIBLE_DEVICES="${GESTURE_GPU:-0}"      # GPU0 (GPU1 keeps HY-Motion)
export GESTURE_PORT="${GESTURE_PORT:-8802}"
GLSM_DIR="${GESTURELSM_DIR:-/home/ai-ccore/Documents/DEV/gesturelsm}"
cd "$GLSM_DIR"
source .venv/bin/activate
exec python gesture_service.py
