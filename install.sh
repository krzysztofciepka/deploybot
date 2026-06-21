#!/usr/bin/env bash
set -euo pipefail
SSH_HOST="${SSH_HOST:-server}"
CONTAINER="${CONTAINER:-n8n}"
REMOTE_TMP="/tmp/deploybot-workflow.json"
cd "$(dirname "$0")"
echo "Building workflow.json…"; node src/build.js
echo "Copying to ${SSH_HOST}…"; scp workflow.json "${SSH_HOST}:${REMOTE_TMP}"
echo "Importing into n8n container '${CONTAINER}'…"
ssh "${SSH_HOST}" "docker cp ${REMOTE_TMP} ${CONTAINER}:${REMOTE_TMP} && docker exec ${CONTAINER} n8n import:workflow --input=${REMOTE_TMP} && rm -f ${REMOTE_TMP}"
echo "Imported INACTIVE. Finish in the n8n UI: create credentials, set allowedChatIds, Activate."
