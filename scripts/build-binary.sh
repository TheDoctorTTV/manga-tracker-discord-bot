#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.build"
DIST_DIR="$ROOT_DIR/dist"
BUNDLE_FILE="$BUILD_DIR/app.bundle.cjs"
SEA_CONFIG_FILE="$BUILD_DIR/sea-config.json"
SEA_BLOB_FILE="$BUILD_DIR/sea-prep.blob"
DEFAULT_OUTPUT="$DIST_DIR/manga-tracker"
OUTPUT_BIN="${1:-$DEFAULT_OUTPUT}"

SENTINEL_FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

require_tool() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required tool: $cmd"
    exit 1
  fi
}

require_tool node
require_tool npm

mkdir -p "$BUILD_DIR" "$DIST_DIR"

echo "[1/5] Bundling app"
(
  cd "$ROOT_DIR"
  npx --yes esbuild src/app.js \
    --bundle \
    --platform=node \
    --format=cjs \
    --target=node20 \
    --outfile="$BUNDLE_FILE" \
    --external:bufferutil \
    --external:utf-8-validate
)

echo "[2/5] Preparing SEA config"
cat > "$SEA_CONFIG_FILE" <<JSON
{
  "main": "$BUNDLE_FILE",
  "output": "$SEA_BLOB_FILE",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
JSON

echo "[3/5] Building SEA blob"
node --experimental-sea-config "$SEA_CONFIG_FILE"

echo "[4/5] Copying Node runtime"
cp "$(command -v node)" "$OUTPUT_BIN"
chmod +w "$OUTPUT_BIN"

echo "[5/5] Injecting blob"
if [[ "$(uname -s)" == "Darwin" ]]; then
  npx --yes postject "$OUTPUT_BIN" NODE_SEA_BLOB "$SEA_BLOB_FILE" \
    --sentinel-fuse "$SENTINEL_FUSE" \
    --macho-segment-name NODE_SEA
else
  npx --yes postject "$OUTPUT_BIN" NODE_SEA_BLOB "$SEA_BLOB_FILE" \
    --sentinel-fuse "$SENTINEL_FUSE"
fi

chmod +x "$OUTPUT_BIN"

if [[ -f "$ROOT_DIR/manga-sources.json" ]]; then
  cp "$ROOT_DIR/manga-sources.json" "$DIST_DIR/manga-sources.json"
fi

if [[ -f "$ROOT_DIR/src/web/dashboard.html" ]]; then
  cp "$ROOT_DIR/src/web/dashboard.html" "$DIST_DIR/dashboard.html"
fi

if [[ -f "$ROOT_DIR/src/web/dashboard.css" ]]; then
  cp "$ROOT_DIR/src/web/dashboard.css" "$DIST_DIR/dashboard.css"
fi

echo "Binary build complete: $OUTPUT_BIN"
echo "Run with: $OUTPUT_BIN"
