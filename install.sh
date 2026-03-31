#!/bin/bash
set -e

echo "=== Flexi Repo Scanner — Setup ==="
echo ""

# Check Python version
PYTHON=""
for cmd in python3.12 python3.11 python3; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON="$cmd"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3.11+ required. Install Python and try again."
    exit 1
fi

PYVER=$($PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Using Python $PYVER ($PYTHON)"

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    $PYTHON -m venv venv
fi

source venv/bin/activate
echo "Installing Python dependencies..."
pip install -q -r requirements.txt

# Copy example configs if config/ doesn't exist
if [ ! -d "config" ]; then
    echo ""
    echo "Creating config directory from examples..."
    mkdir -p config/tasks
    cp examples/settings.example.yaml config/settings.yaml
    cp examples/connections.example.yaml config/connections.yaml
    for f in examples/tasks/*.example.yaml; do
        basename=$(basename "$f" .example.yaml)
        cp "$f" "config/tasks/${basename}.yaml"
    done
    echo "  Config files created in config/."
    echo "  Edit them with your settings (API keys, GitHub token, etc.)"
fi

# Create data directory
mkdir -p data

# Build frontend if Node is available
if command -v node &>/dev/null; then
    echo ""
    echo "Building frontend..."
    cd frontend
    npm install --silent 2>/dev/null || npm install
    npm run build
    cd ..
    echo "Frontend built successfully."
else
    echo ""
    echo "NOTE: Node.js not found. Frontend will not be built."
    echo "  Install Node.js 18+ and run: cd frontend && npm install && npm run build"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit config/settings.yaml  — add LLM API keys, SMTP settings"
echo "  2. Edit config/connections.yaml — add GitHub repos and token"
echo "  3. Edit config/tasks/*.yaml — customise scan tasks"
echo "  4. Run: source venv/bin/activate && python -m backend.main"
echo "  5. Open: http://localhost:8400"
echo ""
echo "Optional: Install as system service:"
echo "  sudo cp flexi-repo-scanner.service /etc/systemd/system/"
echo "  sudo systemctl enable --now flexi-repo-scanner"
