#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="manga-tracker-discord-bot"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_USER="${BOT_USER:-$USER}"
WORKDIR="${BOT_WORKDIR:-$ROOT_DIR}"
ENV_FILE="${ENV_FILE:-$WORKDIR/.env}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
TEMPLATE_FILE="$ROOT_DIR/systemd/${SERVICE_NAME}.service"
TMP_SERVICE_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_SERVICE_FILE"
}
trap cleanup EXIT

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node.js binary not found. Install Node.js 20+ and try again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js 20+ (which includes npm) and try again."
  exit 1
fi

if [[ ! -f "$WORKDIR/package.json" ]]; then
  echo "package.json not found in $WORKDIR"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Create it first: cp $WORKDIR/.env.example $ENV_FILE"
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Service template not found: $TEMPLATE_FILE"
  exit 1
fi

sed \
  -e "s|__BOT_USER__|$BOT_USER|g" \
  -e "s|__WORKDIR__|$WORKDIR|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  "$TEMPLATE_FILE" > "$TMP_SERVICE_FILE"

echo "Installing dependencies with npm ci --omit=dev"
(cd "$WORKDIR" && npm ci --omit=dev)

echo "Installing systemd unit"
sudo install -m 644 "$TMP_SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo
echo "Setup complete."
echo "Start:   sudo systemctl start $SERVICE_NAME"
echo "Status:  sudo systemctl status $SERVICE_NAME --no-pager"
echo "Logs:    journalctl -u $SERVICE_NAME -f"
