#!/bin/bash
# Runs inside ghcr.io/pterodactyl/installers:debian during egg install / reinstall.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq curl ca-certificates tar >/dev/null

cd /mnt/server
mkdir -p data/backgrounds

REPO="${GIT_REPO:-}"
BRANCH="${GIT_BRANCH:-main}"
TOKEN="${GIT_TOKEN:-}"

if [ -z "$REPO" ]; then
  echo "GIT_REPO is empty — upload Poliv files via SFTP or set GIT_REPO to https://github.com/USER/Poliv"
  [ -f start.sh ] && chmod +x start.sh
  echo "Poliv install finished"
  exit 0
fi

REPO="${REPO%.git}"
REPO="${REPO%/}"
if [ -n "$TOKEN" ]; then
  ARCHIVE_URL="$(echo "$REPO" | sed "s#https://github.com/#https://x-access-token:${TOKEN}@github.com/#")/archive/refs/heads/${BRANCH}.tar.gz"
else
  ARCHIVE_URL="${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
fi

echo "Fetching ${ARCHIVE_URL}"
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/src.tgz" "$ARCHIVE_URL"
tar -xzf "$TMP/src.tgz" -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$SRC" ]; then
  echo "ERROR: empty archive"
  exit 1
fi

# Keep data/ (sqlite + backgrounds). Do not copy node_modules/dist from the archive.
for item in "$SRC"/*; do
  name="$(basename "$item")"
  case "$name" in
    data|node_modules|dist) continue ;;
  esac
  rm -rf "/mnt/server/$name"
  cp -a "$item" "/mnt/server/$name"
done

mkdir -p /mnt/server/data/backgrounds
chmod +x /mnt/server/start.sh
echo "Poliv files installed from ${REPO}@${BRANCH}"
rm -rf "$TMP"
