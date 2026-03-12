#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-manga-tracker-discord-bot}"
INSTALL_DIR="${INSTALL_DIR:-/opt/manga-tracker-discord-bot}"
BINARY_NAME="${BINARY_NAME:-manga-tracker}"
ENV_FILE="${ENV_FILE:-/etc/manga-tracker-discord-bot.env}"
FORCE="${FORCE:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR_DEFAULT=""
if [[ "$(basename "$SCRIPT_DIR")" == "manga-tracker-linux" ]]; then
  PACKAGE_DIR_DEFAULT="$SCRIPT_DIR"
fi
PACKAGE_DIR="${PACKAGE_DIR:-$PACKAGE_DIR_DEFAULT}"

UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
TARGET_BINARY="${INSTALL_DIR}/${BINARY_NAME}"

RED_BOLD="\033[1;31m"
RESET_COLOR="\033[0m"

if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

echo -e "${RED_BOLD}WARNING: This will permanently delete ALL Manga Tracker install artifacts.${RESET_COLOR}"
echo -e "${RED_BOLD}Items to be deleted:${RESET_COLOR}"
echo "  - systemd unit: $UNIT_FILE"
echo "  - install directory: $INSTALL_DIR"
echo "  - environment file: $ENV_FILE"
if [[ -n "$PACKAGE_DIR" ]]; then
  echo "  - release package directory: $PACKAGE_DIR"
fi
echo

if [[ "$FORCE" != "1" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Type DELETE to continue: " CONFIRM_INPUT
    if [[ "$CONFIRM_INPUT" != "DELETE" ]]; then
      echo "Aborted. Nothing was deleted."
      exit 1
    fi
  else
    echo "Non-interactive shell detected."
    echo "Re-run with FORCE=1 to confirm full deletion."
    exit 1
  fi
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

echo "Removing installed files"
$SUDO rm -f "$TARGET_BINARY"
$SUDO rm -rf "$INSTALL_DIR"
$SUDO rm -f "$ENV_FILE"

if [[ -n "$PACKAGE_DIR" && -d "$PACKAGE_DIR" ]]; then
  if [[ "$PWD" == "$PACKAGE_DIR" || "$PWD" == "$PACKAGE_DIR/"* ]]; then
    echo "Scheduling package directory cleanup after script exit: $PACKAGE_DIR"
    (
      sleep 1
      rm -rf "$PACKAGE_DIR"
    ) >/dev/null 2>&1 &
  else
    echo "Removing package directory: $PACKAGE_DIR"
    rm -rf "$PACKAGE_DIR"
  fi
fi

echo "Uninstall complete."
