#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
RELEASE_DIR="$DIST_DIR/release"
PKG_NAME="${PKG_NAME:-manga-tracker-linux}"
PKG_DIR="$RELEASE_DIR/$PKG_NAME"
ARCHIVE_PATH="$RELEASE_DIR/${PKG_NAME}.tar.gz"
SOURCE_BINARY="${BINARY_PATH:-$DIST_DIR/manga-tracker}"

require_tool() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required tool: $cmd"
    exit 1
  fi
}

require_tool tar
require_tool sha256sum

if [[ "${SKIP_BINARY_BUILD:-0}" != "1" ]]; then
  echo "[1/4] Building binary"
  "$ROOT_DIR/scripts/build-binary.sh"
fi

if [[ ! -x "$SOURCE_BINARY" ]]; then
  echo "Binary not found or not executable: $SOURCE_BINARY"
  exit 1
fi

echo "[2/4] Preparing release package folder"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

install -m 755 "$SOURCE_BINARY" "$PKG_DIR/manga-tracker"
install -m 755 "$ROOT_DIR/release/linux/install_systemd_service.sh" "$PKG_DIR/install_systemd_service.sh"
install -m 755 "$ROOT_DIR/release/linux/uninstall_systemd_service.sh" "$PKG_DIR/uninstall_systemd_service.sh"
install -m 644 "$ROOT_DIR/release/linux/LINUX_INSTALL.md" "$PKG_DIR/LINUX_INSTALL.md"
install -m 644 "$ROOT_DIR/.env.example" "$PKG_DIR/.env.example"

echo "[3/4] Creating archive $ARCHIVE_PATH"
mkdir -p "$RELEASE_DIR"
tar -C "$RELEASE_DIR" -czf "$ARCHIVE_PATH" "$PKG_NAME"

echo "[4/4] Writing checksum"
sha256sum "$ARCHIVE_PATH" > "${ARCHIVE_PATH}.sha256"

echo "Release package ready:"
echo "  $ARCHIVE_PATH"
echo "  ${ARCHIVE_PATH}.sha256"
