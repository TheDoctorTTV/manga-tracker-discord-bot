#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-manga-tracker-discord-bot}"
INSTALL_DIR="${INSTALL_DIR:-/opt/manga-tracker-discord-bot}"
BINARY_NAME="${BINARY_NAME:-manga-tracker}"
ENV_FILE="${ENV_FILE:-/etc/manga-tracker-discord-bot.env}"
BOT_USER_DEFAULT="${SUDO_USER:-$USER}"
BOT_USER="${BOT_USER:-$BOT_USER_DEFAULT}"
BOT_GROUP="${BOT_GROUP:-$BOT_USER}"
DASHBOARD_PORT="${DASHBOARD_PORT:-9898}"
DASHBOARD_HOST="${DASHBOARD_HOST:-0.0.0.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BINARY="${SCRIPT_DIR}/${BINARY_NAME}"
TARGET_BINARY="${INSTALL_DIR}/${BINARY_NAME}"
DATA_DIR="${INSTALL_DIR}/manga_data"
SOURCE_DASHBOARD_HTML="${SCRIPT_DIR}/dashboard.html"
SOURCE_DASHBOARD_CSS="${SCRIPT_DIR}/dashboard.css"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

require_cmd systemctl
require_cmd install
require_cmd grep

if [[ ! -x "$SOURCE_BINARY" ]]; then
  echo "Missing executable binary: $SOURCE_BINARY"
  echo "Run this script from the extracted release package folder."
  exit 1
fi

if ! id -u "$BOT_USER" >/dev/null 2>&1; then
  echo "User $BOT_USER does not exist. Create it or pass BOT_USER=<existing-user>."
  exit 1
fi

echo "Installing binary to $TARGET_BINARY"
$SUDO mkdir -p "$INSTALL_DIR"
$SUDO mkdir -p "$DATA_DIR"
$SUDO install -m 755 "$SOURCE_BINARY" "$TARGET_BINARY"
$SUDO chown "$BOT_USER:$BOT_GROUP" "$INSTALL_DIR"
$SUDO chown "$BOT_USER:$BOT_GROUP" "$DATA_DIR"
$SUDO chown "$BOT_USER:$BOT_GROUP" "$TARGET_BINARY"

if [[ -f "$SOURCE_DASHBOARD_HTML" ]]; then
  $SUDO install -m 644 "$SOURCE_DASHBOARD_HTML" "${INSTALL_DIR}/dashboard.html"
fi

if [[ -f "$SOURCE_DASHBOARD_CSS" ]]; then
  $SUDO install -m 644 "$SOURCE_DASHBOARD_CSS" "${INSTALL_DIR}/dashboard.css"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -z "${DISCORD_TOKEN:-}" ]]; then
    echo "Missing $ENV_FILE and DISCORD_TOKEN is not set."
    echo "Pass DISCORD_TOKEN in the install command or create $ENV_FILE first."
    exit 1
  fi

  echo "Creating $ENV_FILE"
  $SUDO tee "$ENV_FILE" >/dev/null <<EOF
DISCORD_TOKEN=$DISCORD_TOKEN
DASHBOARD_PORT=$DASHBOARD_PORT
DASHBOARD_HOST=$DASHBOARD_HOST
EOF
  $SUDO chown "$BOT_USER:$BOT_GROUP" "$ENV_FILE"
  $SUDO chmod 600 "$ENV_FILE"
fi

if ! $SUDO grep -Eq '^DISCORD_TOKEN=.+' "$ENV_FILE"; then
  if [[ -n "${DISCORD_TOKEN:-}" ]]; then
    $SUDO sh -c "printf '\nDISCORD_TOKEN=%s\n' '$DISCORD_TOKEN' >> '$ENV_FILE'"
  else
    echo "DISCORD_TOKEN is not set in $ENV_FILE."
    echo "Set it and rerun, or pass DISCORD_TOKEN=... in the install command."
    exit 1
  fi
fi

$SUDO chown "$BOT_USER:$BOT_GROUP" "$ENV_FILE"
$SUDO chmod 600 "$ENV_FILE"

echo "Installing systemd unit $UNIT_FILE"
$SUDO tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=Manga Tracker Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$BOT_USER
Group=$BOT_GROUP
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
Environment=BOT_ENV_FILE=$ENV_FILE
ExecStart=$TARGET_BINARY
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE_NAME"
$SUDO systemctl restart "$SERVICE_NAME"

echo
echo "Install complete."
echo "Service: $SERVICE_NAME"
echo "Binary:  $TARGET_BINARY"
echo "Env:     $ENV_FILE"
echo "Status:  sudo systemctl status $SERVICE_NAME --no-pager"
echo "Logs:    journalctl -u $SERVICE_NAME -f"
if [[ "$DASHBOARD_HOST" == "0.0.0.0" ]]; then
  echo "Dashboard: http://<server-ip-or-domain>:$DASHBOARD_PORT"
  DETECTED_IPS="$(hostname -I 2>/dev/null | xargs || true)"
  if [[ -n "$DETECTED_IPS" ]]; then
    echo "Detected IP(s): $DETECTED_IPS"
    FIRST_IP="${DETECTED_IPS%% *}"
    echo "Try first:  http://$FIRST_IP:$DASHBOARD_PORT"
  fi
else
  echo "Dashboard: http://$DASHBOARD_HOST:$DASHBOARD_PORT"
fi

if ! $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Warning: service is not active yet. Check:"
  echo "  sudo systemctl status $SERVICE_NAME --no-pager"
  echo "  journalctl -u $SERVICE_NAME -n 100 --no-pager"
fi
