#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="manga-tracker-discord-bot"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_USER="${BOT_USER:-$USER}"
WORKDIR="${BOT_WORKDIR:-$ROOT_DIR}"
ENV_FILE="${ENV_FILE:-$WORKDIR/.env}"
BOT_BINARY="${BOT_BINARY:-$WORKDIR/dist/manga-tracker}"
TEMPLATE_FILE="$ROOT_DIR/systemd/${SERVICE_NAME}.service"
TMP_SERVICE_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_SERVICE_FILE"
}
trap cleanup EXIT

ensure_node_tooling() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return
  fi

  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null 2>&1 || true
  fi
}

ensure_node_tooling

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Run ./scripts/bootstrap.sh first, then retry."
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

if [[ ! -x "$BOT_BINARY" ]]; then
  echo "Binary not found at $BOT_BINARY"
  echo "Installing dependencies with npm ci --omit=dev"
  (cd "$WORKDIR" && npm ci --omit=dev)
  echo "Building binary with npm run build:binary"
  (cd "$WORKDIR" && npm run build:binary)
fi

if [[ ! -x "$BOT_BINARY" ]]; then
  echo "Binary still missing or not executable: $BOT_BINARY"
  exit 1
fi

sed \
  -e "s|__BOT_USER__|$BOT_USER|g" \
  -e "s|__WORKDIR__|$WORKDIR|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  -e "s|__BIN_PATH__|$BOT_BINARY|g" \
  "$TEMPLATE_FILE" > "$TMP_SERVICE_FILE"

echo "Installing systemd unit"
sudo install -m 644 "$TMP_SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo
echo "Setup complete."
echo "Start:   sudo systemctl start $SERVICE_NAME"
echo "Status:  sudo systemctl status $SERVICE_NAME --no-pager"
echo "Logs:    journalctl -u $SERVICE_NAME -f"
