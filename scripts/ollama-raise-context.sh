#!/usr/bin/env bash
#
# Safely raise the Ollama serving context window so large agent requests
# (Cline etc.) stop overflowing and surfacing as gateway 502/400.
#
# WHY THIS SCRIPT EXISTS
#   Ollama allocates KV cache for  NUM_PARALLEL * CONTEXT_LENGTH  tokens.
#   The box runs a ~40 GB model (qwen3-coder-next:IQ4_XS) on 2x24 GB, leaving
#   only ~4 GB free. The current RUNNING config is:
#       OLLAMA_NUM_PARALLEL=6  OLLAMA_CONTEXT_LENGTH=32768   ->  6*32768 = 196608
#   The override.conf on disk was ALREADY edited to CONTEXT_LENGTH=65536 but
#   NEVER applied (daemon-reload/restart missing). Applying it as-is would give
#       6*65536 = 393216  -> ~2x KV  -> almost certainly OOM on load.
#
#   This script instead lowers NUM_PARALLEL while raising CONTEXT_LENGTH so the
#   total KV budget stays ~equal to today's (which we KNOW fits), then verifies
#   the model actually loads and rolls back automatically if it does not.
#
# DEFAULT TARGET (edit the two numbers below if you want a different trade-off):
#   NUM_PARALLEL=3  CONTEXT_LENGTH=65536  ->  3*65536 = 196608  (== current KV)
#     => single-request ceiling 65536 (was 32768), 3 concurrent reqs (was 6).
#   Alternatives:
#     keep concurrency, smaller bump : NUM_PARALLEL=6  CONTEXT_LENGTH=40960
#     safest / most headroom         : NUM_PARALLEL=2  CONTEXT_LENGTH=65536
#
# Run as root:   sudo bash scripts/ollama-raise-context.sh
set -euo pipefail

NUM_PARALLEL="${NUM_PARALLEL:-3}"
CONTEXT_LENGTH="${CONTEXT_LENGTH:-65536}"

OVERRIDE=/etc/systemd/system/ollama.service.d/override.conf
MODEL_TAG="qwen3-coder-next:IQ4_XS"   # the Always-Running / pinned model
OLLAMA_URL="http://127.0.0.1:11434"

if [[ $EUID -ne 0 ]]; then echo "Must run as root (sudo)."; exit 1; fi
if [[ ! -f "$OVERRIDE" ]]; then echo "Not found: $OVERRIDE"; exit 1; fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${OVERRIDE}.bak.${STAMP}"
cp -a "$OVERRIDE" "$BACKUP"
echo "Backed up -> $BACKUP"
echo "Target: NUM_PARALLEL=$NUM_PARALLEL  CONTEXT_LENGTH=$CONTEXT_LENGTH  (KV budget = $((NUM_PARALLEL*CONTEXT_LENGTH)) tokens)"

restart_ollama() { systemctl daemon-reload; systemctl restart ollama; }

wait_up() {  # wait until the API answers (max ~60s)
  for _ in $(seq 1 60); do
    curl -fsS "$OLLAMA_URL/api/version" >/dev/null 2>&1 && return 0; sleep 1
  done; return 1
}

load_model() {  # force-load + pin the model at the new context; max ~180s
  curl -fsS "$OLLAMA_URL/api/generate" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$MODEL_TAG\",\"prompt\":\"\",\"keep_alive\":-1}" \
    --max-time 180 >/dev/null 2>&1
}

model_loaded() {  # true if the model shows up in /api/ps
  curl -fsS "$OLLAMA_URL/api/ps" 2>/dev/null | grep -q "$MODEL_TAG"
}

rollback() {
  echo "!! Rolling back to previous config ($BACKUP)"
  cp -a "$BACKUP" "$OVERRIDE"
  restart_ollama; wait_up || true; load_model || true
  echo "Rolled back. Current /api/ps:"; curl -fsS "$OLLAMA_URL/api/ps" 2>/dev/null || true
}

# --- apply new config (preserve every other Environment= line) ---
sed -i -E "s/^Environment=\"OLLAMA_NUM_PARALLEL=.*/Environment=\"OLLAMA_NUM_PARALLEL=${NUM_PARALLEL}\"/" "$OVERRIDE"
sed -i -E "s/^Environment=\"OLLAMA_CONTEXT_LENGTH=.*/Environment=\"OLLAMA_CONTEXT_LENGTH=${CONTEXT_LENGTH}\"/" "$OVERRIDE"
echo "--- new override.conf ---"; grep -E 'NUM_PARALLEL|CONTEXT_LENGTH' "$OVERRIDE"

echo "Restarting ollama..."; restart_ollama
if ! wait_up; then echo "ollama did not come up"; rollback; exit 1; fi

echo "Loading + pinning $MODEL_TAG at ctx=$CONTEXT_LENGTH ..."
load_model || true
sleep 3
if ! model_loaded; then
  echo "Model failed to load at the new context (likely VRAM/OOM)."
  rollback; exit 1
fi

# Confirm no GPU is essentially out of memory (need a little free headroom).
MINFREE=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | sort -n | head -1)
echo "Min free VRAM across GPUs: ${MINFREE} MiB"
if [[ "${MINFREE:-0}" -lt 150 ]]; then
  echo "VRAM dangerously low (<150 MiB free) — backing out to be safe."
  rollback; exit 1
fi

echo "OK. Loaded model state:"
curl -fsS "$OLLAMA_URL/api/ps" 2>/dev/null | tr ',' '\n' | grep -E 'name|context_length|size_vram' || true
echo
echo "DONE. Single-request context is now ${CONTEXT_LENGTH}. Backup kept at $BACKUP"
echo "If anything misbehaves, revert with:  sudo cp -a '$BACKUP' '$OVERRIDE' && sudo systemctl daemon-reload && sudo systemctl restart ollama"
