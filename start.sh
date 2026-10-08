#!/bin/bash
set -euo pipefail
cd /home/container || exit 1

export HOME=/home/container
export HOST=0.0.0.0
export PORT="${SERVER_PORT:-8787}"
export npm_config_cache="/home/container/.npm"
export PATH="/usr/local/bin:/usr/bin:${PATH}"

if [ ! -f package.json ]; then
  echo "ERROR: нет package.json. Укажи GIT_REPO и переустанови сервер или залей файлы Полива."
  exit 1
fi

if [ ! -d node_modules ] || [ "${AUTO_UPDATE:-0}" = "1" ]; then
  echo "Installing npm packages..."
  npm install
fi

echo "Building frontend..."
npm run build

echo "Starting Poliv on ${HOST}:${PORT}"
exec npm start
