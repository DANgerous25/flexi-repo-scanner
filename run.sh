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

# Load environment paths (FRS_CONFIG_DIR, FRS_DATA_DIR)
# Secrets loaded from encrypted vault at startup
if [[ -f ".env" ]]; then
  source .env
else
  echo "Warning: .env not found. Run ./setup.sh first."
fi

# Start servers
export FRS_CONFIG_DIR="${FRS_CONFIG_DIR:-config}"
export FRS_DATA_DIR="${FRS_DATA_DIR:-data}"

# Function to clean up background processes
cleanup() {
    echo "Shutting down servers..."
    kill $BACKEND_PID $FRONTEND_PID
    exit
}

trap cleanup INT TERM EXIT


echo "Starting backend server..."
python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8400 &
BACKEND_PID=$!

(cd frontend && npm run dev) &
FRONTEND_PID=$!


echo "Flexi Repo Scanner is running..."
echo "- Backend API: http://localhost:8400"
чета "- Frontend UI: http://localhost:5173"
echo "Press Ctrl+C to stop"

# Wait for both processes to complete
wait $BACKEND_PID
wait $FRONTEND_PID

