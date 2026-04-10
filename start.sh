#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TAILSCALE_IP="$(tailscale ip -4 2>/dev/null || echo "")"
PIDFILE="$SCRIPT_DIR/.frs.pid"
LOGFILE="/tmp/flexi.log"
PORT=8400

check_running() {
    if [[ -f "$PIDFILE" ]]; then
        OLD_PID=$(cat "$PIDFILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            return 0
        fi
        rm -f "$PIDFILE"
    fi
    return 1
}

if check_running; then
    OLD_PID=$(cat "$PIDFILE")
    echo "Flexi Repo Scanner is already running (PID $OLD_PID). Stopping..."
    "$SCRIPT_DIR/stop.sh"
    sleep 2
    if check_running; then
        echo "ERROR: Failed to stop existing process"
        exit 1
    fi
    echo "Previous instance stopped."
fi

echo "Pulling latest code..."
git pull

echo "Building frontend..."
cd frontend
npm run build
cd "$SCRIPT_DIR"

echo "Starting Flexi Repo Scanner..."

if [[ -f ".venv/bin/activate" ]]; then
    source .venv/bin/activate
else
    echo "Error: .venv not found. Run ./setup.sh first."
    exit 1
fi

if [[ -f ".env" ]]; then
    source .env
else
    echo "Warning: .env not found. Run ./setup.sh first."
fi

export FRS_CONFIG_DIR="${FRS_CONFIG_DIR:-config}"
export FRS_DATA_DIR="${FRS_DATA_DIR:-data}"
export TAILSCALE_IP="$TAILSCALE_IP"

nohup python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port "$PORT" \
    >> "$LOGFILE" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PIDFILE"

sleep 2
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "ERROR: Backend failed to start. Check $LOGFILE"
    rm -f "$PIDFILE"
    exit 1
fi

echo ""
echo "Flexi Repo Scanner started (PID $BACKEND_PID)"
echo "  Local:       http://localhost:$PORT"
if [[ -n "$TAILSCALE_IP" ]]; then
    echo "  Tailscale:   http://$TAILSCALE_IP:$PORT"
fi
echo "  Log:         $LOGFILE"
echo "  PID file:    $PIDFILE"
echo ""
echo "Use ./stop.sh to stop, ./restart.sh to restart."
