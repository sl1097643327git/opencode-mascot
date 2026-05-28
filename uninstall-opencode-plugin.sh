#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ "${1:-}" = "--check" ]; then
  echo "uninstall-opencode-plugin.sh OK"
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

echo "[INFO] Uninstalling opencode mascot plugin..."
node scripts/uninstall-opencode-plugin.js
echo "[OK] opencode mascot plugin uninstalled."
echo "[INFO] mascot.json user settings were preserved."
echo "[INFO] Restart opencode to stop loading the plugin."
