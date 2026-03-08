#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="manga-tracker-discord-bot"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_REF="${1:-}"

cd "$ROOT_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has uncommitted changes. Commit/stash before updating."
  exit 1
fi

echo "Fetching latest changes"
git fetch --tags origin

if [[ -n "$TARGET_REF" ]]; then
  echo "Checking out $TARGET_REF"
  git checkout "$TARGET_REF"
else
  CURRENT_REF="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$CURRENT_REF" == "HEAD" ]]; then
    echo "Detached HEAD detected. Pass a branch or tag: ./scripts/update.sh v1.2.0"
    exit 1
  fi
  TARGET_REF="$CURRENT_REF"
fi

if git show-ref --verify --quiet "refs/heads/$TARGET_REF"; then
  echo "Pulling latest commits for branch $TARGET_REF"
  git pull --ff-only origin "$TARGET_REF"
else
  echo "Using non-branch ref $TARGET_REF"
fi

echo "Installing dependencies"
npm ci --omit=dev

echo "Restarting service"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager
