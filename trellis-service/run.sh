#!/usr/bin/env bash
# Start the TRELLIS.2 service (image -> textured GLB), localhost only. Uses the
# `trellis2` CONDA env created by TRELLIS.2's own setup.sh (compiled CUDA deps:
# flash-attn, nvdiffrast, o-voxel, flexgemm — a plain venv won't do). Pins to ONE
# GPU via CUDA_VISIBLE_DEVICES so the other 24GB card stays free for the LLM/others.
set -e
cd "$(dirname "$0")"
SVC_DIR="$(pwd)"

# Which physical GPU this worker uses. Default GPU1: it is kept free of the
# GestureLSM workers that share GPU0, so a resident (pinned) TRELLIS.2 has the
# headroom for 1024/1536 instead of OOMing against ~0.5GB of spare VRAM. Set
# TRELLIS_GPU=0 to force the first card.
export CUDA_VISIBLE_DEVICES="${TRELLIS_GPU:-1}"

# The official example enables expandable segments to fit 24GB; keep it.
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
export OPENCV_IO_ENABLE_OPENEXR=1

# Where install_trellis.sh cloned microsoft/TRELLIS.2 (added to sys.path by the runner).
export TRELLIS_REPO="${TRELLIS_REPO:-$SVC_DIR/TRELLIS.2}"
export TRELLIS_MODEL="${TRELLIS_MODEL:-microsoft/TRELLIS.2-4B}"
export TRELLIS_RESOLUTION="${TRELLIS_RESOLUTION:-512}"
export TRELLIS_PORT="${TRELLIS_PORT:-8811}"
# 1 = keep the pipeline resident in VRAM (Always Running); 0 = offload each stage to
# CPU between requests (On Demand). The gateway sets this per startup policy when it
# spawns the service; default 0 for a manual launch.
export TRELLIS_PIN_VRAM="${TRELLIS_PIN_VRAM:-0}"

# Fully-local runtime: once the weights (TRELLIS.2-4B) and the gated encoders
# (facebook/dinov3-vitl16-pretrain-lvd1689m, briaai/RMBG-2.0) are in the HF cache,
# never touch the network again. install_trellis.sh pre-caches them; on a fresh box
# do the first load with HF_HUB_OFFLINE=0 (and an HF token) to populate the cache.
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"

# Activate the conda env (override with CONDA_ENV / CONDA_BASE if needed).
CONDA_BASE="${CONDA_BASE:-$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")}"
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate "${CONDA_ENV:-trellis2}"

# Point runtime CUDA at the env-local toolkit (nvdiffrast JIT-compiles its plugin
# on first use and needs nvcc + headers). RTX 3090 = sm_86. Deliberately NOT adding
# $CONDA_PREFIX/lib to LD_LIBRARY_PATH (torch loads its CUDA runtime via rpath; a
# global env-lib override can shadow system libs used by child processes).
export CUDA_HOME="${CUDA_HOME:-$CONDA_PREFIX}"
export PATH="$CUDA_HOME/bin:$PATH"
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.6}"

# Run from the TRELLIS.2 repo so its relative config/asset paths resolve; the
# service file is referenced by absolute path (pidfile is written next to it).
[ -d "$TRELLIS_REPO" ] && cd "$TRELLIS_REPO"
exec python "$SVC_DIR/trellis_service.py"
