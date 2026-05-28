#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ "${1:-}" = "--check" ]; then
  echo "install-opencode-plugin.sh OK"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found in PATH." >&2
  echo "Please install Node.js first: https://nodejs.org/" >&2
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "[ERROR] package.json was not found." >&2
  echo "Please run this script from the desktop mascot project folder." >&2
  exit 1
fi

echo "[INFO] Installing opencode mascot plugin..."
node scripts/install-opencode-plugin.js
echo "[OK] opencode mascot plugin installed."
echo "[INFO] Dependencies and opencode plugin config have been prepared."
echo "[INFO] If installation completed successfully, restart opencode and the mascot should load automatically."
