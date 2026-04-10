#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PIDFILE="$SCRIPT_DIR/.frs.pid"

if [[ ! -f "$PIDFILE" ]]; then
    echo "Flexi Repo Scanner is not running (no PID file found)."
    # Also try to kill any orphaned uvicorn processes on port 8400
    ORPHAN=$(lsof -ti :8400 2>/dev/null || true)
    if [[ -n "$ORPHAN" ]]; then
        echo "Found orphaned process on port 8400 (PID $ORPHAN), killing..."
        kill $ORPHAN 2>/dev/null || true
        sleep 1
        kill -9 $ORPHAN 2>/dev/null || true
        echo "Orphaned process killed."
    fi
    exit 0
fi

PID=$(cat "$PIDFILE")

if ! kill -0 "$PID" 2>/dev/null; then
    echo "Process $PID is not running. Cleaning up PID file."
    rm -f "$PIDFILE"
    # Also try to kill any orphaned uvicorn processes
    ORPHAN=$(lsof -ti :8400 2>/dev/null || true)
    if [[ -n "$ORPHAN" ]]; then
        echo "Found orphaned process on port 8400, killing..."
        kill $ORPHAN 2>/dev/null || true
        sleep 1
        kill -9 $ORPHAN 2>/dev/null || true
    fi
    exit 0
fi

echo "Stopping Flexi Repo Scanner (PID $PID)..."
kill "$PID" 2>/dev/null || true

TIMEOUT=10
ELAPSED=0
while kill -0 "$PID" 2>/dev/null; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    if [[ $ELAPSED -ge $TIMEOUT ]]; then
        echo "Process did not stop gracefully, force killing..."
        kill -9 "$PID" 2>/dev/null || true
        sleep 1
        break
    fi
done

if kill -0 "$PID" 2>/dev/null; then
    echo "WARNING: Process $PID may still be running"
else
    echo "Flexi Repo Scanner stopped."
fi

rm -f "$PIDFILE"

# Double-check port 8400 is free
ORPHAN=$(lsof -ti :8400 2>/dev/null || true)
if [[ -n "$ORPHAN" ]]; then
    echo "Killing remaining processes on port 8400..."
    kill $ORPHAN 2>/dev/null || true
    sleep 1
    kill -9 $ORPHAN 2>/dev/null || true
fi