#!/usr/bin/env bash
# Phase 0 install: deps + weights for real HY-Motion 1.0 (into motion-service/.venv
# and assets/HY-Motion-1.0/ckpts). FBX SDK is intentionally skipped (we use the
# "dict" output and write .vmd ourselves). ~22GB download.
set -eo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate
REPO=assets/HY-Motion-1.0
LOG() { echo "[$(date +%H:%M:%S)] $*"; }
rm -f .phase0_install_done .phase0_install_failed

trap 'LOG "FAILED at line $LINENO"; touch .phase0_install_failed' ERR

LOG "1/5 torch 2.5.1 (cu124)"
pip install --no-cache-dir torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124

LOG "2/5 HY-Motion requirements (minus fbxsdkpy)"
grep -v -i 'fbxsdkpy' "$REPO/requirements.txt" > /tmp/hym_reqs.txt
pip install --no-cache-dir -r /tmp/hym_reqs.txt

LOG "3/5 verify torch+cuda"
python -c "import torch,numpy; print('torch',torch.__version__,'numpy',numpy.__version__,'cuda',torch.cuda.is_available())"

export HF_HUB_DISABLE_TELEMETRY=1
LOG "4/5 download DiT standard (~4.2GB) + CLIP (~1.7GB)"
huggingface-cli download tencent/HY-Motion-1.0 --include "HY-Motion-1.0/*" --local-dir "$REPO/ckpts/tencent"
huggingface-cli download openai/clip-vit-large-patch14 --local-dir "$REPO/ckpts/clip-vit-large-patch14"
LOG "5/5 download Qwen3-8B text encoder (~16GB)"
huggingface-cli download Qwen/Qwen3-8B --local-dir "$REPO/ckpts/Qwen3-8B"

LOG "disk:"; df -h / | tail -1
LOG "ckpts:"; du -sh "$REPO/ckpts"/* 2>/dev/null || true
LOG "DONE"
touch .phase0_install_done
