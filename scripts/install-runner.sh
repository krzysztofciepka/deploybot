#!/usr/bin/env bash
# scripts/install-runner.sh — install/update the runner on `server`
set -euo pipefail
SSH_HOST="${SSH_HOST:-server}"
REMOTE_DIR=/opt/apps/deploybot-runner
cd "$(dirname "$0")/.."

echo "Syncing runner to ${SSH_HOST}:${REMOTE_DIR}…"
ssh "$SSH_HOST" "mkdir -p ${REMOTE_DIR}"
scp -r runner/server.js runner/lib "$SSH_HOST:$REMOTE_DIR/"
scp runner/systemd/deploybot-runner.service "$SSH_HOST:/etc/systemd/system/deploybot-runner.service"

ssh "$SSH_HOST" bash -s <<'EOF'
set -euo pipefail
if [ ! -f /opt/apps/deploybot-runner/.env ]; then
  cat > /opt/apps/deploybot-runner/.env <<'ENV'
TELEGRAM_BOT_TOKEN=CHANGEME
OPENCODE_API_KEY=CHANGEME
GITHUB_TOKEN=CHANGEME
JOB_TIMEOUT_MS=1200000
DISK_FLOOR_BYTES=2000000000
ENV
  chmod 600 /opt/apps/deploybot-runner/.env
  echo "WROTE placeholder .env — edit it with real secrets before starting."
fi
systemctl daemon-reload
systemctl enable deploybot-runner
echo "Installed. After editing .env: systemctl restart deploybot-runner"
EOF
echo "Done."
