#!/usr/bin/env bash
# OPTIONAL cleanup. gesturelsm already lives at
# AICCORE-Nexus/stack/gesturelsm and works -- including across reboots.
#
# What still exists is a compatibility symlink at DEV/gesturelsm, kept because
# /etc/systemd/system/gesturelsm@.service is root-owned and could not be edited
# during the migration. The unit still names the old path; the symlink is what
# makes that resolve.
#
# This script points the unit at the real path and drops the symlink, so
# DEV/ finally contains nothing but AICCORE-Nexus. Run as ai-ccore, NOT sudo --
# it calls sudo itself, so you get one password prompt:
#
#     bash finalize-gesturelsm.sh
#
# Skipping it is fine. The symlink is stable, not a time bomb.
set -euo pipefail

DEV="/home/ai-ccore/Documents/DEV"
LINK="$DEV/gesturelsm"
REAL="$DEV/AICCORE-Nexus/stack/gesturelsm"
UNIT="/etc/systemd/system/gesturelsm@.service"

[ -d "$REAL" ] || { echo "expected $REAL to exist -- nothing to finalize"; exit 1; }
if [ ! -L "$LINK" ]; then
  echo "no symlink at $LINK; already finalized (or never created)"
  exit 0
fi

echo "==> 1/4 rewriting $UNIT to use the real path"
sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=GestureLSM gesture service on port %i
After=network.target

[Service]
Type=simple
User=ai-ccore
WorkingDirectory=$REAL
Environment=CUDA_VISIBLE_DEVICES=0
Environment=GESTURE_PORT=%i
ExecStart=$REAL/.venv/bin/python gesture_service.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "==> 2/4 reloading systemd and restarting the service"
sudo systemctl daemon-reload
sudo systemctl restart gesturelsm@8802.service

echo "==> 3/4 waiting for :8802 to answer before removing the symlink"
ok=0
for _ in $(seq 1 40); do
  sleep 5
  if curl -s -o /dev/null -m 4 http://127.0.0.1:8802/healthz; then ok=1; break; fi
done
if [ "$ok" -ne 1 ]; then
  echo "service did not come back -- leaving the symlink in place so nothing breaks."
  echo "investigate with: systemctl status gesturelsm@8802.service"
  exit 1
fi

echo "==> 4/4 removing the compatibility symlink"
rm "$LINK"

echo
echo "done. DEV/ now contains only AICCORE-Nexus (plus anything you added yourself)."
systemctl is-active gesturelsm@8802.service
curl -s -m 5 http://127.0.0.1:8802/healthz | head -c 120; echo
