#!/usr/bin/env bash
# Robust one-time setup for the TRELLIS.2 service on the lab server.
#
# Handles this box's realities (vs. the upstream "clean CUDA 12.4 + sudo" assumption):
#   - No conda        -> auto-installs Miniconda to ~/miniconda3.
#   - Dual CUDA (11.8 + distro 12.4) -> installs an ENV-LOCAL CUDA 12.4 toolkit and
#                        pins CUDA_HOME to it, so torch(cu124) extensions build cleanly.
#   - No sudo         -> patches setup.sh to drop its `sudo apt` + pillow-simd lines
#                        (stock pillow comes in via gradio/imageio).
#
# Prereqs: Linux, NVIDIA GPU >= 24GB VRAM, an NVIDIA driver, git, ~40GB free disk.
# Weights (microsoft/TRELLIS.2-4B) download on first /generate.
#
# Run from this directory:  ./install_trellis.sh   (logs to logs/install.log too)
set -uo pipefail
cd "$(dirname "$0")"
SVC_DIR="$(pwd)"
REPO_DIR="${TRELLIS_REPO:-$SVC_DIR/TRELLIS.2}"
CONDA_ENV="${CONDA_ENV:-trellis2}"
CUDA_VER="${TRELLIS_CUDA_VER:-12.4}"

log() { echo "[install $(date +%H:%M:%S)] $*"; }
die() { echo "[install ERROR] $*" >&2; exit 1; }

# 0. Miniconda -------------------------------------------------------------
CONDA_BASE="${CONDA_BASE:-$HOME/miniconda3}"
if ! command -v conda >/dev/null 2>&1 && [ ! -x "$CONDA_BASE/bin/conda" ]; then
  log "conda not found -> installing Miniconda to $CONDA_BASE"
  MC="/tmp/miniconda_installer.sh"
  curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o "$MC" || die "miniconda download failed"
  bash "$MC" -b -p "$CONDA_BASE" || die "miniconda install failed"
  rm -f "$MC"
fi
[ -x "$CONDA_BASE/bin/conda" ] || CONDA_BASE="$(conda info --base)"
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh" || die "cannot source conda.sh"
log "conda: $(conda --version)"

# Recent conda gates the Anaconda default channels behind a Terms-of-Service accept.
# Accept non-interactively (no-op on older conda that lacks `tos`).
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main 2>/dev/null || true
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r 2>/dev/null || true

# 1. Clone TRELLIS.2 (with submodules) ------------------------------------
if [ ! -d "$REPO_DIR/.git" ]; then
  log "cloning microsoft/TRELLIS.2 -> $REPO_DIR"
  git clone -b main --recursive https://github.com/microsoft/TRELLIS.2.git "$REPO_DIR" || die "clone failed"
else
  log "TRELLIS.2 already cloned at $REPO_DIR (fetching submodules)"
  ( cd "$REPO_DIR" && git submodule update --init --recursive ) || true
fi

# 2. Patch upstream setup.sh: drop the sudo apt + pillow-simd lines --------
#    (no passwordless sudo here; stock pillow is pulled by gradio/imageio).
if grep -q "sudo apt install" "$REPO_DIR/setup.sh"; then
  log "patching setup.sh (remove sudo apt / pillow-simd)"
  sed -i -e '/sudo apt install/d' -e '/pip install pillow-simd/d' "$REPO_DIR/setup.sh"
fi

# 3. Create env + torch (cu124) -------------------------------------------
if ! conda env list | grep -qE "^\s*$CONDA_ENV\s"; then
  log "creating conda env '$CONDA_ENV' (python 3.10)"
  conda create -y -n "$CONDA_ENV" python=3.10 || die "env create failed"
fi
conda activate "$CONDA_ENV" || die "cannot activate $CONDA_ENV"
log "python: $(python --version)"

if ! python -c "import torch" 2>/dev/null; then
  log "installing torch 2.6.0 + torchvision 0.21.0 (cu124)"
  pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124 || die "torch install failed"
fi

# 4. Env-local CUDA 12.4 toolkit -> stable CUDA_HOME for extension builds --
if [ ! -x "$CONDA_PREFIX/bin/nvcc" ]; then
  log "installing env-local cuda-toolkit $CUDA_VER (nvidia channel)"
  conda install -y -c "nvidia/label/cuda-${CUDA_VER}.0" cuda-toolkit || \
    conda install -y -c nvidia "cuda-toolkit=$CUDA_VER" || die "cuda-toolkit install failed"
fi
export CUDA_HOME="$CONDA_PREFIX"
export PATH="$CUDA_HOME/bin:$PATH"
# NOTE: do NOT put $CONDA_PREFIX/lib on LD_LIBRARY_PATH — it shadows the system
# libffi and breaks the system `git` (git-remote-https -> libp11-kit) that pip
# uses to clone the extension repos. nvcc finds libs via CUDA_HOME; torch loads
# its own via rpath. Keep the loader path clean here.
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.6}"   # RTX 3090 = sm_86
export MAX_JOBS="${MAX_JOBS:-4}"                              # cap build RAM
log "CUDA_HOME=$CUDA_HOME ; nvcc: $($CUDA_HOME/bin/nvcc --version | tail -1)"

# 5. Build the stack via the patched upstream setup.sh (env already active) -
log "running upstream setup.sh build steps (this is the long part: flash-attn + CUDA exts)"
( cd "$REPO_DIR" && . ./setup.sh --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm ) \
  || die "setup.sh build failed (see log above)"

# 5b. flash-attn — upstream `pip install flash-attn` fails under build isolation
#     (its setup.py imports torch, absent in the isolated build env) and building
#     from source is slow/fragile. Install the matching PREBUILT wheel instead.
if ! python -c "import flash_attn" 2>/dev/null; then
  ABI=$(python -c "import torch;print('TRUE' if torch._C._GLIBCXX_USE_CXX11_ABI else 'FALSE')")
  PYTAG=cp$(python -c "import sys;print(f'{sys.version_info.major}{sys.version_info.minor}')")
  FA="flash_attn-2.7.3+cu12torch2.6cxx11abi${ABI}-${PYTAG}-${PYTAG}-linux_x86_64.whl"
  log "installing flash-attn prebuilt wheel ($FA)"
  pip install --no-cache-dir "https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.3/$FA" \
    || die "flash-attn wheel install failed (check torch/cuda/abi/python match)"
fi

# 6. Service deps ----------------------------------------------------------
log "installing service deps (fastapi, uvicorn, python-multipart, pillow)"
pip install -r "$SVC_DIR/requirements.txt" || die "service deps failed"

# 7. Sanity import + reclaim caches ---------------------------------------
#    trellis2 is used from the repo (not pip-installed); the service adds
#    TRELLIS_REPO to sys.path, so mirror that here.
log "verifying imports"
TRELLIS_REPO="$REPO_DIR" python - <<'PY' || die "import check failed"
import os, sys
sys.path.insert(0, os.environ["TRELLIS_REPO"])
import torch, o_voxel, flash_attn, nvdiffrast, cumesh, flex_gemm  # noqa
from trellis2.pipelines import Trellis2ImageTo3DPipeline  # noqa
print("[install] torch", torch.__version__, "cuda", torch.version.cuda, "avail", torch.cuda.is_available())
print("[install] full TRELLIS.2 stack import OK")
PY
conda clean -a -y >/dev/null 2>&1 || true
rm -rf /tmp/extensions 2>/dev/null || true

# 7b. Pre-cache the model weights so run.sh can default to HF_HUB_OFFLINE=1.
#     Needs HF auth for the two gated encoders; skipped (with a note) if no token.
if [ -s "$HOME/.cache/huggingface/token" ] || [ -n "${HF_TOKEN:-}" ]; then
  log "pre-caching weights (TRELLIS.2-4B + DINOv3 + RMBG-2.0) for offline runtime"
  python - <<'PY' || echo "[install] pre-cache had issues; first run.sh load may need HF_HUB_OFFLINE=0 once"
from huggingface_hub import snapshot_download
for r in ["microsoft/TRELLIS.2-4B", "facebook/dinov3-vitl16-pretrain-lvd1689m", "briaai/RMBG-2.0"]:
    print("  fetching", r); snapshot_download(r)
print("[install] weights pre-cached")
PY
fi

# 8. Gated-dependency reminder --------------------------------------------
#    The pipeline's image encoder (facebook/dinov3-vitl16-pretrain-lvd1689m) is a
#    GATED HF repo. Without access the pipeline load 401s and stays in stub mode.
if [ ! -s "$HOME/.cache/huggingface/token" ] && [ -z "${HF_TOKEN:-}" ]; then
  echo
  echo "[install] ACTION REQUIRED: the DINOv3 image encoder is a GATED HF repo."
  echo "[install]   1) Accept: https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m"
  echo "[install]   2) Authenticate:  conda activate $CONDA_ENV && huggingface-cli login   (or export HF_TOKEN=hf_...)"
  echo "[install] Until then, /generate returns 501 and the model shows Offline."
fi

log "DONE. Start with:  ./run.sh   (binds 127.0.0.1:8811)"
log "Then register in the gateway:  npx tsx scripts/setup-trellis.ts"
