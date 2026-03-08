#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NVM_VERSION="v0.40.3"
NODE_VERSION="20"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required. Install curl first and retry."
  exit 1
fi

if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "Installing nvm $NVM_VERSION"
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
fi

# shellcheck disable=SC1090
source "$NVM_DIR/nvm.sh"

echo "Installing Node.js $NODE_VERSION"
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

echo "Running service setup"
"$ROOT_DIR/scripts/setup.sh"
