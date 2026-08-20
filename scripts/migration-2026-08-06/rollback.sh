#!/usr/bin/env bash
# Undo the 2026-08-06 consolidation: rename AICCORE-Nexus back to "AICCORE Nexus"
# and move the four backend folders back out to /home/ai-ccore/Documents/DEV.
#
#     bash rollback.sh
#
# NOTE the space: restoring "AICCORE Nexus" also restores the flashinfer/ninja
# breakage that forced the rename, so vLLM will not start from inside it. That is
# why the folders move back OUT to DEV/ here rather than staying under the
# renamed directory -- vllm-voice must live on a path with no space in it.
set -uo pipefail

DEV="/home/ai-ccore/Documents/DEV"
NEXUS="$DEV/AICCORE-Nexus"
STACK="$NEXUS/stack"
REPAIR="$(cd "$(dirname "$0")" && pwd)/repair_venv.py"

echo "== stopping services (gesturelsm@8802 is systemd-managed and left alone) =="
for port in 3000 8000 8807 8893 9881 9880; do
  pid=$(ss -ltnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null && echo "  TERM -> :$port"
done
sleep 10

echo "== restoring gesturelsm =="
# It is systemd-managed (Restart=always), so the unit must be stopped first --
# this is the one step here that needs root.
sudo systemctl stop gesturelsm@8802.service 2>/dev/null || \
  echo "  (could not stop the unit; it will flap until you do)"
[ -L "$DEV/gesturelsm" ] && rm "$DEV/gesturelsm"          # compatibility symlink
if [ -d "$STACK/gesturelsm" ]; then
  mv "$STACK/gesturelsm" "$DEV/gesturelsm"
  python3 "$REPAIR" "$DEV/gesturelsm/.venv" "$STACK/gesturelsm/.venv" "$DEV/gesturelsm/.venv"
  sed -i 's|\$HOME/Documents/DEV/AICCORE-Nexus/stack/gesturelsm|$HOME/Documents/DEV/gesturelsm|g' \
    "$DEV/gesturelsm/cleanup_outputs.sh"
  crontab -l 2>/dev/null | sed "s|$STACK/gesturelsm|$DEV/gesturelsm|g" | crontab -
fi

echo "== moving the four folders back to $DEV =="
[ -d "$STACK/voice" ]           && mv "$STACK/voice"           "$DEV/voice"
[ -d "$STACK/vllm-voice" ]      && mv "$STACK/vllm-voice"      "$DEV/vllm-voice"
[ -d "$STACK/ActionPlan-Code" ] && mv "$STACK/ActionPlan-Code" "$DEV/ActionPlan-Code"
if [ -d "$STACK/world-perception" ]; then
  mkdir -p "$DEV/services"
  mv "$STACK/world-perception" "$DEV/services/world-perception"
fi
rmdir "$STACK" 2>/dev/null

echo "== renaming AICCORE-Nexus back to 'AICCORE Nexus' =="
mv "$NEXUS" "$DEV/AICCORE Nexus"
BACK="$DEV/AICCORE Nexus"

echo "== repointing venvs =="
python3 "$REPAIR" "$DEV/vllm-voice/.venv"      "$STACK/vllm-voice/.venv"      "$DEV/vllm-voice/.venv"
python3 "$REPAIR" "$DEV/ActionPlan-Code/venv"  "$STACK/ActionPlan-Code/venv"  "$DEV/ActionPlan-Code/venv"
python3 "$REPAIR" "$DEV/voice/GPT-SoVITS/.venv" "$STACK/voice/GPT-SoVITS/.venv" "$DEV/voice/GPT-SoVITS/.venv"
python3 "$REPAIR" "$DEV/voice/Applio/.venv"    "$STACK/voice/Applio/.venv"    "$DEV/voice/Applio/.venv"
for r in "" /runners/sam2 /runners/moge /runners/grounding_dino; do
  python3 "$REPAIR" "$DEV/services/world-perception$r/.venv" \
    "$STACK/world-perception$r/.venv" "$DEV/services/world-perception$r/.venv"
done
for v in model-service motion-service mcp-tools; do
  python3 "$REPAIR" "$BACK/$v/.venv" "$NEXUS/$v/.venv" "$BACK/$v/.venv"
done

echo "== repointing text references =="
grep -rlZ --binary-files=without-match "AICCORE-Nexus" "$BACK" 2>/dev/null \
  | while IFS= read -r -d '' f; do
      case "$f" in */.venv/*|*/venv/*|*/.git/*|*/node_modules/*|*/.next/*) ;;
        *) sed -i 's|AICCORE-Nexus|AICCORE Nexus|g' "$f" ;; esac
    done
grep -rlZ --binary-files=without-match "$STACK" "$DEV/voice" "$DEV/ActionPlan-Code" "$DEV/services" 2>/dev/null \
  | while IFS= read -r -d '' f; do
      case "$f" in */.venv/*|*/venv/*|*/.git/*|*/__pycache__/*) ;;
        *) sed -i "s|$STACK/world-perception|$DEV/services/world-perception|g; s|$STACK/|$DEV/|g" "$f" ;; esac
    done

echo "== dropping the .env overrides added for the move =="
sed -i '/^VOICE_DIR=/d; /^TTS_REF_AUDIO=/d; /^# Voice stack moved under stack\//d; /^# .next\/ bundle picks up/d' "$BACK/.env"

echo
echo "rollback complete. Restart the services from $DEV -- and note that the"
echo "restored folder name contains a space again, so vLLM will fail to JIT-build"
echo "flashinfer if you ever move vllm-voice back inside it."
