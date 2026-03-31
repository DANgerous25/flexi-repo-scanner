#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate venv
if [[ -f ".venv/bin/activate" ]]; then
  source .venv/bin/activate
else
  echo "Error: .venv not found. Run ./setup.sh first."
  exit 1
fi

# Load environment variables
if [[ -f ".env" ]]; then
  source .env
else
  echo "Warning: .env not found. Run ./setup.sh or create .env with your API keys."
fi

# Start server
export FRS_CONFIG_DIR="${FRS_CONFIG_DIR:-config}"
export FRS_DATA_DIR="${FRS_DATA_DIR:-data}"

echo "Starting Flexi Repo Scanner on http://localhost:8400"
echo "Press Ctrl+C to stop"
echo ""

exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8400
