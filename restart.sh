#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Restarting Flexi Repo Scanner..."
"$SCRIPT_DIR/stop.sh"
"$SCRIPT_DIR/start.sh"
