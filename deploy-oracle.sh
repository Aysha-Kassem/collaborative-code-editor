#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${DEPLOY_HOST:-129.159.223.104}"
USER_NAME="${DEPLOY_USER:-opc}"
SSH_KEY="${DEPLOY_SSH_KEY:-$ROOT_DIR/ssh-key-2026-04-19.key}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/home/opc/collaborative-code-editor-live}"
NODE_BIN_DIR="${DEPLOY_NODE_BIN_DIR:-/home/opc/node-v20.19.0-linux-x64/bin}"
APP_NAME="${DEPLOY_APP_NAME:-collab-editor}"
TUNNEL_NAME="${DEPLOY_TUNNEL_NAME:-collab-tunnel}"

echo "==> Building Next.js app locally"
cd "$ROOT_DIR"
npm run build

echo "==> Syncing project files to ${USER_NAME}@${HOST}:${REMOTE_DIR}"
rsync -avP --delete \
  -e "ssh -i '$SSH_KEY' -o StrictHostKeyChecking=no" \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude 'node_modules' \
  --exclude 'ssh-key-*.key' \
  --exclude '*.pem' \
  --exclude '.DS_Store' \
  --exclude 'nohup.out' \
  .next \
  components \
  hooks \
  lib \
  pages \
  styles \
  package.json \
  package-lock.json \
  next.config.js \
  next-env.d.ts \
  tsconfig.json \
  README.md \
  ecosystem.config.js \
  "$USER_NAME@$HOST:$REMOTE_DIR/"

echo "==> Restarting app and tunnel on the server"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$USER_NAME@$HOST" "
  set -euo pipefail
  export PATH='$NODE_BIN_DIR':\"\$PATH\"
  mkdir -p '$REMOTE_DIR'
  cd '$REMOTE_DIR'
  npm install --omit=dev

  if pm2 describe '$APP_NAME' >/dev/null 2>&1; then
    pm2 restart '$APP_NAME' --update-env
  else
    pm2 start \"npx next start -H 0.0.0.0 -p 3000\" --name '$APP_NAME'
  fi

  if pm2 describe '$TUNNEL_NAME' >/dev/null 2>&1; then
    pm2 delete '$TUNNEL_NAME'
  fi

  pm2 start \"\$HOME/cloudflared tunnel --protocol http2 --url http://127.0.0.1:3000\" --name '$TUNNEL_NAME'
  pm2 save
  echo '--- PM2 STATUS ---'
  pm2 status
  echo '--- HEALTH CHECK ---'
  curl -I http://127.0.0.1:3000 || true
  echo '--- TUNNEL URL ---'
  grep -o 'https://[^ ]*trycloudflare.com' ~/.pm2/logs/$TUNNEL_NAME-error.log | tail -n 1 || true
"

echo "==> Deployment complete"
