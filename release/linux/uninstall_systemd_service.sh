#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-manga-tracker-discord-bot}"
INSTALL_DIR="${INSTALL_DIR:-/opt/manga-tracker-discord-bot}"
BINARY_NAME="${BINARY_NAME:-manga-tracker}"
ENV_FILE="${ENV_FILE:-/etc/manga-tracker-discord-bot.env}"
PURGE="${PURGE:-0}"

UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
TARGET_BINARY="${INSTALL_DIR}/${BINARY_NAME}"

if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

if command -v systemctl >/dev/null 2>&1; then
  if $SUDO systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
    echo "Stopping and disabling $SERVICE_NAME"
    $SUDO systemctl stop "$SERVICE_NAME" || true
    $SUDO systemctl disable "$SERVICE_NAME" || true
  fi
fi

if [[ -f "$UNIT_FILE" ]]; then
  echo "Removing $UNIT_FILE"
  $SUDO rm -f "$UNIT_FILE"
fi

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl daemon-reload || true
fi

if [[ "$PURGE" == "1" ]]; then
  echo "Purging installed files"
  $SUDO rm -f "$TARGET_BINARY"
  $SUDO rm -rf "$INSTALL_DIR"
  $SUDO rm -f "$ENV_FILE"
else
  echo "Keeping binary/env files."
  echo "Set PURGE=1 to remove $INSTALL_DIR and $ENV_FILE."
fi

echo "Uninstall complete."
