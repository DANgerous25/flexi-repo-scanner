#!/usr/bin/env bash
set -euo pipefail

# ─── Flexi Repo Scanner — Interactive Setup ──────────────────────────────
# Walks you through everything: deps, config, API keys, first run.
# Safe to re-run — detects existing config and only updates what you change.
# No manual file editing required.

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

TOTAL_STEPS=7
CURRENT_STEP=0

step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  echo ""
  echo -e "${CYAN}${BOLD}[$CURRENT_STEP/$TOTAL_STEPS] $1${RESET}"
  echo -e "${DIM}$(printf '%.0s─' {1..60})${RESET}"
}

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}!${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
info() { echo -e "  $1"; }

ask() {
  local prompt="$1"
  local var_name="$2"
  local default="${3:-}"
  if [[ -n "$default" ]]; then
    echo -ne "  ${prompt} ${DIM}[${default}]${RESET}: "
  else
    echo -ne "  ${prompt}: "
  fi
  read -r input
  if [[ -z "$input" && -n "$default" ]]; then
    eval "$var_name='$default'"
  else
    eval "$var_name='$input'"
  fi
}

ask_secret() {
  local prompt="$1"
  local var_name="$2"
  # Note: we use visible input because read -s swallows special chars
  # (@, etc.) on many terminals/SSH sessions. Secrets are encrypted
  # in the vault immediately after entry and never logged.
  echo -ne "  ${prompt}: "
  read -r input
  eval "$var_name='$input'"
}

ask_yn() {
  local prompt="$1"
  local default="${2:-y}"
  local hint="Y/n"
  [[ "$default" == "n" ]] && hint="y/N"
  echo -ne "  ${prompt} ${DIM}[${hint}]${RESET}: "
  read -r input
  input="${input:-$default}"
  [[ "${input,,}" == "y" || "${input,,}" == "yes" ]]
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Detect re-run ───────────────────────────────────────────────────────

IS_RERUN=false
if [[ -f "config/settings.yaml" || -f "data/secrets.enc" || -f "config/connections.yaml" ]]; then
  IS_RERUN=true
fi

# ─── Header ──────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║       Flexi Repo Scanner — Setup Wizard         ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

if [[ "$IS_RERUN" == "true" ]]; then
  echo -e "  Existing configuration detected."
  echo -e "  Press ${BOLD}Enter${RESET} to keep current values. Only enter new values to change them."

  # Show existing vault keys
  if [[ -f ".venv/bin/activate" ]]; then
    source .venv/bin/activate 2>/dev/null || true
    EXISTING_KEYS=$(python3 -c "
import sys; sys.path.insert(0, '.')
try:
    from backend.storage.secrets import SecretsVault
    v = SecretsVault(data_dir='data')
    keys = v.list_keys()
    if keys:
        print(', '.join(keys))
except Exception:
    pass
" 2>/dev/null || true)
    if [[ -n "${EXISTING_KEYS:-}" ]]; then
      echo ""
      echo -e "  ${GREEN}Encrypted secrets already stored:${RESET} ${DIM}${EXISTING_KEYS}${RESET}"
    fi
  fi
else
  echo -e "  This will set up everything you need to run the scanner."
  echo -e "  Press ${BOLD}Enter${RESET} to accept defaults. Skip any step you want."
fi
echo ""

# ─── Step 1: Check & Install Prerequisites ──────────────────────────────

step "Checking prerequisites"

# Detect OS / package manager
PKG_MGR=""
if command -v apt-get &>/dev/null; then
  PKG_MGR="apt"
elif command -v dnf &>/dev/null; then
  PKG_MGR="dnf"
elif command -v yum &>/dev/null; then
  PKG_MGR="yum"
elif command -v pacman &>/dev/null; then
  PKG_MGR="pacman"
elif command -v brew &>/dev/null; then
  PKG_MGR="brew"
fi

install_pkg() {
  local name="$1"
  local pkg_apt="${2:-$1}"
  local pkg_brew="${3:-$1}"
  local pkg_dnf="${4:-$1}"
  local pkg_pacman="${5:-$1}"

  info "${BOLD}${name}${RESET} is required but not installed."

  case "$PKG_MGR" in
    apt)
      if ask_yn "Install via apt? (sudo apt-get install $pkg_apt)" "y"; then
        sudo apt-get update -qq && sudo apt-get install -y -qq "$pkg_apt"
        return $?
      fi
      ;;
    dnf)
      if ask_yn "Install via dnf? (sudo dnf install $pkg_dnf)" "y"; then
        sudo dnf install -y "$pkg_dnf"
        return $?
      fi
      ;;
    yum)
      if ask_yn "Install via yum? (sudo yum install $pkg_dnf)" "y"; then
        sudo yum install -y "$pkg_dnf"
        return $?
      fi
      ;;
    pacman)
      if ask_yn "Install via pacman? (sudo pacman -S $pkg_pacman)" "y"; then
        sudo pacman -S --noconfirm "$pkg_pacman"
        return $?
      fi
      ;;
    brew)
      if ask_yn "Install via Homebrew? (brew install $pkg_brew)" "y"; then
        brew install "$pkg_brew"
        return $?
      fi
      ;;
    *)
      fail "No supported package manager found."
      ;;
  esac
  return 1
}

# Helper: install Node.js via NodeSource if apt (gets current LTS instead of old distro version)
install_node_apt() {
  info "${BOLD}Node.js${RESET} is required but not installed."
  echo ""
  info "  1) Install via NodeSource (recommended — gets Node 20 LTS)"
  info "  2) Install distro package (nodejs — may be outdated)"
  info "  3) Skip — I'll install it myself"
  echo -ne "  Choose ${DIM}[1-3]${RESET}: "
  read -r node_choice

  case "$node_choice" in
    1)
      info "Installing Node.js 20 LTS via NodeSource..."
      if ! command -v curl &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq curl
      fi
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | tail -3
      sudo apt-get install -y -qq nodejs
      return $?
      ;;
    2)
      sudo apt-get update -qq && sudo apt-get install -y -qq nodejs npm
      return $?
      ;;
    *)
      return 1
      ;;
  esac
}

# Git (required — you wouldn't be here without it, but check anyway)
if command -v git &>/dev/null; then
  ok "Git $(git --version | awk '{print $3}')"
else
  if ! install_pkg "Git" "git" "git" "git" "git"; then
    fail "Git is required. Install it and re-run setup."
    exit 1
  fi
  ok "Git installed"
fi

# Python
if command -v python3 &>/dev/null; then
  PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
  ok "Python $PY_VER"
else
  if ! install_pkg "Python 3" "python3 python3-venv python3-pip" "python3" "python3" "python"; then
    fail "Python 3 is required. Install it and re-run setup."
    exit 1
  fi
  ok "Python $(python3 --version 2>&1 | awk '{print $2}') installed"
fi

# Ensure python3-venv is available (common issue on Ubuntu/Debian)
if [[ "$PKG_MGR" == "apt" ]] && ! python3 -m venv --help &>/dev/null; then
  info "Installing python3-venv (needed for virtual environment)..."
  sudo apt-get install -y -qq python3-venv
fi

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>&1)
  ok "Node.js $NODE_VER"
else
  INSTALLED_NODE=false
  if [[ "$PKG_MGR" == "apt" ]]; then
    if install_node_apt; then
      INSTALLED_NODE=true
    fi
  elif [[ -n "$PKG_MGR" ]]; then
    if install_pkg "Node.js" "nodejs" "node" "nodejs" "nodejs"; then
      INSTALLED_NODE=true
    fi
  fi

  if [[ "$INSTALLED_NODE" == "true" ]] && command -v node &>/dev/null; then
    ok "Node.js $(node --version) installed"
  else
    fail "Node.js is required for the frontend. Install from https://nodejs.org and re-run setup."
    exit 1
  fi
fi

# Ollama (optional)
if command -v ollama &>/dev/null; then
  ok "Ollama installed"
  OLLAMA_INSTALLED=true
else
  warn "Ollama not found — LLM features will need cloud API keys"
  if ask_yn "Install Ollama now? (for local LLM inference)" "n"; then
    info "Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh 2>&1 | tail -3
    if command -v ollama &>/dev/null; then
      ok "Ollama installed"
      OLLAMA_INSTALLED=true
    else
      warn "Ollama install may need a shell restart — skipping for now"
      OLLAMA_INSTALLED=false
    fi
  else
    info "${DIM}Install later: curl -fsSL https://ollama.ai/install.sh | sh${RESET}"
    OLLAMA_INSTALLED=false
  fi
fi

# ─── Step 2: Install Dependencies ────────────────────────────────────────

step "Installing dependencies"

# Python venv
if [[ ! -d ".venv" ]]; then
  info "Creating Python virtual environment..."
  python3 -m venv .venv
  ok "Virtual environment created"
else
  ok "Virtual environment exists"
fi

source .venv/bin/activate
info "Installing Python packages..."
pip install -q -r requirements.txt 2>&1 | tail -1
ok "Python dependencies installed"

# Frontend
if [[ -d "frontend" ]]; then
  cd frontend
  if [[ ! -d "node_modules" ]]; then
    info "Installing frontend packages..."
    npm install --silent 2>&1 | tail -1
    ok "Frontend dependencies installed"
  else
    ok "Frontend dependencies exist"
  fi

  if [[ ! -d "dist" ]] || ask_yn "Rebuild frontend?" "n"; then
    info "Building frontend..."
    npm run build --silent 2>&1 | tail -1
    ok "Frontend built"
  else
    ok "Frontend already built"
  fi
  cd "$SCRIPT_DIR"
fi

# ─── Step 3: GitHub Connections ──────────────────────────────────────────

step "GitHub repository connections"

mkdir -p config/tasks

# Show existing connections if re-running
EXISTING_CONNS=0
if [[ -f "config/connections.yaml" ]]; then
  EXISTING_CONNS=$(grep -c 'id:' config/connections.yaml 2>/dev/null || true)
  EXISTING_CONNS=$(echo "$EXISTING_CONNS" | tr -dc '0-9')
  EXISTING_CONNS=${EXISTING_CONNS:-0}
  if [[ $EXISTING_CONNS -gt 0 ]]; then
    info "${GREEN}Existing connections ($EXISTING_CONNS):${RESET}"
    grep 'id:\|owner:\|repo:' config/connections.yaml | sed 's/^/    /'
    echo ""
  fi
fi

SKIP_CONNECTIONS=false
if [[ $EXISTING_CONNS -gt 0 ]]; then
  if ! ask_yn "Reconfigure connections? (Enter to keep existing)" "n"; then
    ok "Keeping $EXISTING_CONNS existing connection(s)"
    SKIP_CONNECTIONS=true
  fi
fi

CONNECTIONS=""
CONN_COUNT=0

if [[ "$SKIP_CONNECTIONS" == "false" ]]; then
  info "Each repo you want to scan needs a GitHub connection."
  info "You'll need a GitHub Personal Access Token (PAT) with repo read access."
  echo ""

  while true; do
    CONN_COUNT=$((CONN_COUNT + 1))

    if [[ $CONN_COUNT -gt 1 ]]; then
      if ! ask_yn "Add another repository?" "n"; then
        break
      fi
    fi

    echo ""
    info "${BOLD}Connection #${CONN_COUNT}${RESET}"
    ask "  Connection name (e.g. 'my-app')" CONN_NAME ""
    [[ -z "$CONN_NAME" ]] && break

    ask "  GitHub owner/org" CONN_OWNER ""
    ask "  Repository name" CONN_REPO ""
    ask "  Default branch" CONN_BRANCH "main"

    # Slugify connection name for ID
    CONN_ID=$(echo "$CONN_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//')

    CONNECTIONS="${CONNECTIONS}  - id: \"${CONN_ID}\"
    name: \"${CONN_NAME}\"
    owner: \"${CONN_OWNER}\"
    repo: \"${CONN_REPO}\"
    token: \"\${GITHUB_TOKEN}\"
    default_branch: \"${CONN_BRANCH}\"
"
  done

  # Write connections.yaml immediately so it persists even if later steps fail
  if [[ -n "$CONNECTIONS" ]]; then
    cat > config/connections.yaml <<EOF
connections:
${CONNECTIONS}
EOF
    ok "$CONN_COUNT connection(s) configured — saved to config/connections.yaml"
  elif [[ ! -f "config/connections.yaml" ]]; then
    warn "No connections configured — you can add them later in config/connections.yaml"
    cat > config/connections.yaml <<EOF
connections: []
EOF
  fi
fi

# GitHub token
echo ""
info "GitHub PAT is used for all connections (encrypted in the vault)."

# Check if token already exists in vault
HAS_GH_TOKEN=false
if [[ -f "data/secrets.enc" ]]; then
  HAS_GH_TOKEN=$(python3 -c "
import sys; sys.path.insert(0, '.')
try:
    from backend.storage.secrets import SecretsVault
    v = SecretsVault(data_dir='data')
    print('true' if v.get('GITHUB_TOKEN') else 'false')
except Exception:
    print('false')
" 2>/dev/null || echo "false")
fi

GH_DEFAULT="y"
[[ "$HAS_GH_TOKEN" == "true" ]] && GH_DEFAULT="n"

if ask_yn "Enter/update your GitHub token?" "$GH_DEFAULT"; then
  ask_secret "  GitHub token (ghp_... or github_pat_...)" GH_TOKEN
  if [[ -n "$GH_TOKEN" ]]; then
    # Save immediately so it persists even if later steps fail
    mkdir -p data
    python3 -m backend.storage.setup_vault --data-dir data --set "GITHUB_TOKEN=${GH_TOKEN}" 2>&1 | tail -1
    ok "Token encrypted and saved"
  fi
else
  GH_TOKEN=""
  if [[ "$HAS_GH_TOKEN" == "true" ]]; then
    ok "Keeping existing token"
  else
    warn "Skipped — add via: python3 -m backend.storage.setup_vault --data-dir data --set GITHUB_TOKEN=ghp_..."
  fi
fi

# ─── Step 4: LLM Providers ──────────────────────────────────────────────

step "LLM providers (for AI-powered code review & benchmarks)"

info "Pattern scanning (regex) works without any LLM keys."
info "LLM providers are only needed for AI code review and benchmarking."
if [[ "$IS_RERUN" == "true" ]]; then
  echo ""
  info "${DIM}Press Enter to skip any key you want to keep unchanged.${RESET}"
fi
echo ""

OLLAMA_URL=""
FALLBACK_ORDER=""
PROVIDERS_YAML=""

# Ollama
if [[ "$OLLAMA_INSTALLED" == "true" ]]; then
  if ask_yn "Use Ollama for local LLM inference?" "y"; then
    ask "  Ollama URL" OLLAMA_URL "http://localhost:11434"
    ask "  Preferred model" OLLAMA_MODEL "qwen3:14b"

    # Check if model is pulled
    if ollama list 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
      ok "Model $OLLAMA_MODEL available"
    else
      if ask_yn "  Pull $OLLAMA_MODEL now? (this may take a while)" "y"; then
        ollama pull "$OLLAMA_MODEL"
        ok "Model pulled"
      else
        warn "  Remember to run: ollama pull $OLLAMA_MODEL"
      fi
    fi

    FALLBACK_ORDER="    - ollama"
    PROVIDERS_YAML="    ollama:
      base_url: \"${OLLAMA_URL}\"
      models:
        - id: \"ollama/${OLLAMA_MODEL}\"
          name: \"${OLLAMA_MODEL} (local)\"
"
  fi
fi

# Cloud providers
echo ""
info "Cloud LLM providers ${DIM}(press Enter to skip any you don't have)${RESET}"
echo ""

declare -A PROVIDER_KEYS
declare -A PROVIDER_MODELS
PROVIDER_KEYS=()
PROVIDER_MODELS=()

# Define providers: name, env_var, default_model, display_model_name
CLOUD_PROVIDERS=(
  "groq|GROQ_API_KEY|groq/llama-3.3-70b-versatile|Llama 3.3 70B (Groq)"
  "deepseek|DEEPSEEK_API_KEY|deepseek/deepseek-chat|DeepSeek Chat"
  "anthropic|ANTHROPIC_API_KEY|anthropic/claude-sonnet-4-6|Claude Sonnet 4"
  "openai|OPENAI_API_KEY|openai/gpt-4.1-mini|GPT-4.1 Mini"
  "mistral|MISTRAL_API_KEY|mistral/mistral-large-latest|Mistral Large"
  "xai|XAI_API_KEY|xai/grok-4.1-fast|Grok 4.1 Fast"
  "openrouter|OPENROUTER_API_KEY|openrouter/auto|OpenRouter Auto"
)

CLOUD_COUNT=0
TOTAL_CLOUD=${#CLOUD_PROVIDERS[@]}

for entry in "${CLOUD_PROVIDERS[@]}"; do
  IFS='|' read -r pname env_var default_model display_name <<< "$entry"
  CLOUD_COUNT=$((CLOUD_COUNT + 1))

  echo -ne "  ${DIM}[${CLOUD_COUNT}/${TOTAL_CLOUD}]${RESET} ${BOLD}${pname}${RESET} API key: "
  read -r key

  if [[ -n "$key" ]]; then
    ok "${pname} configured"
    PROVIDER_KEYS[$pname]="$key"
    FALLBACK_ORDER="${FALLBACK_ORDER}
    - ${pname}"
    PROVIDERS_YAML="${PROVIDERS_YAML}    ${pname}:
      api_key: \"\${${env_var}}\"
      models:
        - id: \"${default_model}\"
          name: \"${display_name}\"
"
  elif [[ "$IS_RERUN" == "true" ]]; then
    # On re-run, skip means "keep existing" — check if it exists in vault
    # and if so, keep the provider in settings.yaml
    HAS_KEY=$(python3 -c "
import sys; sys.path.insert(0, '.')
try:
    from backend.storage.secrets import SecretsVault
    v = SecretsVault(data_dir='data')
    print('yes' if v.get('$env_var') else 'no')
except Exception:
    print('no')
" 2>/dev/null || echo "no")
    if [[ "$HAS_KEY" == "yes" ]]; then
      info "${DIM}  keeping existing ${pname} key${RESET}"
      FALLBACK_ORDER="${FALLBACK_ORDER}
    - ${pname}"
      PROVIDERS_YAML="${PROVIDERS_YAML}    ${pname}:
      api_key: \"\${${env_var}}\"
      models:
        - id: \"${default_model}\"
          name: \"${display_name}\"
"
    fi
  fi
done

# Count configured
CONFIGURED_COUNT=0
[[ -n "$OLLAMA_URL" ]] && CONFIGURED_COUNT=$((CONFIGURED_COUNT + 1))
CONFIGURED_COUNT=$((CONFIGURED_COUNT + ${#PROVIDER_KEYS[@]}))

if [[ $CONFIGURED_COUNT -gt 0 ]]; then
  ok "${CONFIGURED_COUNT} LLM provider(s) configured"
elif [[ "$IS_RERUN" == "true" ]]; then
  info "LLM provider keys unchanged"
else
  warn "No LLM providers configured — pattern scanning still works fine"
fi

# Build fallback_order (clean up leading newline)
if [[ -n "$FALLBACK_ORDER" ]]; then
  FALLBACK_YAML="  fallback_order:
${FALLBACK_ORDER}"
else
  FALLBACK_YAML="  fallback_order: []"
fi

# ─── Step 5: Email Notifications ─────────────────────────────────────────

step "Email notifications (optional)"

info "Configure SMTP to receive scan result emails."
echo ""

SMTP_HOST=""
SMTP_PORT="587"
SMTP_USERNAME=""
SMTP_PASSWORD=""
SMTP_FROM=""
SMTP_NAME="Flexi Repo Scanner"

if ask_yn "Set up email notifications?" "n"; then
  ask "  SMTP host" SMTP_HOST "smtp.gmail.com"
  ask "  SMTP port" SMTP_PORT "587"
  ask "  SMTP username" SMTP_USERNAME ""
  ask_secret "  SMTP password (or app password)" SMTP_PASSWORD
  ask "  From address" SMTP_FROM "scanner@yourdomain.com"
  ask "  From name" SMTP_NAME "Flexi Repo Scanner"
  ok "SMTP configured"
else
  if [[ "$IS_RERUN" == "true" ]]; then
    ok "Keeping existing SMTP configuration"
  else
    warn "Skipped — you can configure email later in config/settings.yaml"
  fi
fi

# ─── Step 6: Write Config Files ─────────────────────────────────────────

step "Writing configuration"

# .env file — only non-secret config (secrets go to encrypted vault)
cat > .env <<ENVEOF
# Flexi Repo Scanner — Environment
# Generated by setup.sh on $(date -u +"%Y-%m-%d %H:%M UTC")
# Secrets are encrypted in data/secrets.enc
export FRS_CONFIG_DIR="config"
export FRS_DATA_DIR="data"
ENVEOF

ok ".env written (paths only — no secrets)"

# Encrypt secrets into the vault (merges with existing)
VAULT_ARGS=()
[[ -n "${GH_TOKEN:-}" ]] && VAULT_ARGS+=(--set "GITHUB_TOKEN=${GH_TOKEN}")
[[ -n "${SMTP_USERNAME:-}" ]] && VAULT_ARGS+=(--set "SMTP_USERNAME=${SMTP_USERNAME}")
[[ -n "${SMTP_PASSWORD:-}" ]] && VAULT_ARGS+=(--set "SMTP_PASSWORD=${SMTP_PASSWORD}")

for pname in "${!PROVIDER_KEYS[@]}"; do
  for entry in "${CLOUD_PROVIDERS[@]}"; do
    IFS='|' read -r name env_var _ _ <<< "$entry"
    if [[ "$name" == "$pname" ]]; then
      VAULT_ARGS+=(--set "${env_var}=${PROVIDER_KEYS[$pname]}")
      break
    fi
  done
done

mkdir -p data
if [[ ${#VAULT_ARGS[@]} -gt 0 ]]; then
  python3 -m backend.storage.setup_vault --data-dir data "${VAULT_ARGS[@]}"
  ok "Secrets encrypted in data/secrets.enc"
elif [[ "$IS_RERUN" == "true" ]]; then
  ok "Existing secrets unchanged"
else
  warn "No secrets provided — add later via the setup wizard or vault CLI"
fi

# settings.yaml — only write if first run or something changed
# On re-run with no changes at all, preserve existing settings.yaml
if [[ "$IS_RERUN" == "true" && -z "$SMTP_HOST" && ${#PROVIDER_KEYS[@]} -eq 0 && -z "$OLLAMA_URL" && -z "$PROVIDERS_YAML" ]]; then
  ok "config/settings.yaml unchanged"
else
  cat > config/settings.yaml <<SETEOF
server:
  host: "0.0.0.0"
  port: 8400

smtp:
  host: "${SMTP_HOST}"
  port: ${SMTP_PORT}
  tls: true
  username: "\${SMTP_USERNAME}"
  password: "\${SMTP_PASSWORD}"
  from_address: "${SMTP_FROM}"
  from_name: "${SMTP_NAME}"

llm:
${FALLBACK_YAML}
  providers:
${PROVIDERS_YAML}
retention:
  results_days: 30
  max_days: 0
SETEOF

  ok "config/settings.yaml written"
fi

# ─── Step 7: Create Example Task ─────────────────────────────────────────

step "Scan tasks"

# Count existing tasks
EXISTING_TASKS=$(ls config/tasks/*.yaml 2>/dev/null | wc -l || true)
EXISTING_TASKS=$(echo "$EXISTING_TASKS" | tr -dc '0-9')
EXISTING_TASKS=${EXISTING_TASKS:-0}

if [[ "$EXISTING_TASKS" -gt 0 ]]; then
  info "${GREEN}Existing tasks:${RESET}"
  for f in config/tasks/*.yaml; do
    tname=$(grep -m1 'name:' "$f" 2>/dev/null | sed 's/.*name: *"\?\([^"]*\)"\?/\1/' || basename "$f")
    echo -e "    ${DIM}$(basename "$f")${RESET} — $tname"
  done
  echo ""
fi

# Get connection count from connections.yaml
CONN_COUNT_FILE=$(grep -c 'id:' config/connections.yaml 2>/dev/null || true)
CONN_COUNT_FILE=$(echo "$CONN_COUNT_FILE" | tr -dc '0-9')
CONN_COUNT_FILE=${CONN_COUNT_FILE:-0}

SHOW_TASK_MENU=false

if [[ "$CONN_COUNT_FILE" -gt 0 ]]; then
  if [[ "$EXISTING_TASKS" -gt 0 ]]; then
    if ask_yn "Add more scan tasks?" "n"; then
      SHOW_TASK_MENU=true
    else
      ok "Keeping $EXISTING_TASKS existing task(s)"
    fi
  else
    SHOW_TASK_MENU=true
  fi

  if [[ "$SHOW_TASK_MENU" == "true" ]]; then
    info "Would you like to create a starter scan task?"
    echo ""
    info "  1) PII & Sensitive Data Scanner (regex patterns)"
    info "  2) AI Authorship & Attribution Scanner (regex patterns)"
    info "  3) LLM Code Review (requires LLM provider)"
    info "  4) Copy all example tasks"
    info "  5) Skip — I'll configure tasks later"
    echo ""
    echo -ne "  Choose ${DIM}[1-5]${RESET}: "
    read -r task_choice

    # Get first connection ID
    FIRST_CONN=$(grep -m1 'id:' config/connections.yaml | sed 's/.*id: *"\(.*\)"/\1/' | tr -d ' ')

    case "$task_choice" in
      1)
        cp examples/tasks/pii-scan.example.yaml config/tasks/pii-scan.yaml
        sed -i.bak "s/\"example-repo\"/\"${FIRST_CONN}\"/" config/tasks/pii-scan.yaml
        rm -f config/tasks/pii-scan.yaml.bak
        ok "PII scanner task created"
        ;;
      2)
        # Create a focused AI attribution scanner
        cat > config/tasks/ai-attribution.yaml <<TASKEOF
id: "ai-attribution"
name: "AI Attribution Scanner"
description: "Detect AI authorship traces, tool references, and attribution"
active: true
connection: "${FIRST_CONN}"
schedule:
  cron: "0 9 * * *"
  timezone: "UTC"
scan:
  mode: "full"
  type: "pattern"
  paths:
    include: ["**/*"]
    exclude: ["node_modules/", "*.lock", "dist/", "build/", "__pycache__/", "*.min.js"]
  rules:
    - id: "vibe-coding"
      name: "Vibe coding reference"
      pattern: '\bvibe[\s\-_]?cod(e|ing)\b'
      severity: "high"
      case_sensitive: false
    - id: "ai-generated"
      name: "AI generated reference"
      pattern: '\bai[\s\-_]?generated\b'
      severity: "high"
      case_sensitive: false
    - id: "claude-code"
      name: "Claude Code reference"
      pattern: '\bclaude[\s\-_]?code\b'
      severity: "high"
      case_sensitive: false
    - id: "built-with-ai"
      name: "Built with AI"
      pattern: '\bbuilt[\s\-_]?(?:by|with|using)[\s\-_]?(?:claude|gpt|ai|chatgpt|copilot|perplexity)\b'
      severity: "critical"
      case_sensitive: false
    - id: "powered-by-ai"
      name: "Powered by AI"
      pattern: '\bpowered[\s\-_]?by[\s\-_]?(?:claude|gpt|chatgpt|copilot|perplexity)\b'
      severity: "critical"
      case_sensitive: false
    - id: "github-copilot"
      name: "GitHub Copilot"
      pattern: '\bgithub[\s\-_]?copilot\b'
      severity: "high"
      case_sensitive: false
  allowlist:
    - file: "CLAUDE.md"
      rules: ["claude-code"]
      reason: "Claude Code config file"
    - file: "AGENTS.md"
      rules: ["claude-code"]
      reason: "Claude Code agents config"
  context_filters:
    - type: "llm-provider-usage"
      enabled: true
actions:
  - type: "in-app-notify"
    trigger: "findings"
TASKEOF
        ok "AI attribution scanner task created"
        ;;
      3)
        cp examples/tasks/code-review.example.yaml config/tasks/code-review.yaml
        sed -i.bak "s/\"example-repo\"/\"${FIRST_CONN}\"/" config/tasks/code-review.yaml
        rm -f config/tasks/code-review.yaml.bak
        ok "LLM code review task created"
        ;;
      4)
        for f in examples/tasks/*.example.yaml; do
          base=$(basename "$f" .example.yaml)
          cp "$f" "config/tasks/${base}.yaml"
          sed -i.bak "s/\"example-repo\"/\"${FIRST_CONN}\"/" "config/tasks/${base}.yaml"
          rm -f "config/tasks/${base}.yaml.bak"
        done
        ok "All example tasks copied"
        ;;
      *)
        warn "Skipped — add task YAML files to config/tasks/ when ready"
        ;;
    esac
  fi
else
  warn "No connections configured — add tasks after setting up connections"
fi

# ─── Summary ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║              Setup Complete                      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

echo -e "  ${BOLD}Files:${RESET}"
echo -e "    .env                        ${DIM}← paths only (gitignored)${RESET}"
echo -e "    data/secrets.enc            ${DIM}← encrypted secrets vault${RESET}"
echo -e "    data/secret.key             ${DIM}← encryption key (chmod 600)${RESET}"
echo -e "    config/settings.yaml        ${DIM}← server, SMTP, LLM providers${RESET}"
echo -e "    config/connections.yaml     ${DIM}← GitHub repos${RESET}"
ls config/tasks/*.yaml 2>/dev/null | while read f; do
  echo -e "    ${f}  ${DIM}← scan task${RESET}"
done

# Show what's in the vault
VAULT_KEYS=$(python3 -c "
import sys; sys.path.insert(0, '.')
try:
    from backend.storage.secrets import SecretsVault
    v = SecretsVault(data_dir='data')
    keys = v.list_keys()
    if keys:
        print(', '.join(keys))
except Exception:
    pass
" 2>/dev/null || true)
if [[ -n "${VAULT_KEYS:-}" ]]; then
  echo ""
  echo -e "  ${BOLD}Encrypted secrets:${RESET} ${DIM}${VAULT_KEYS}${RESET}"
fi

echo ""
echo -e "  ${BOLD}To start the scanner:${RESET}"
echo ""
echo -e "    ${CYAN}./run.sh${RESET}"
echo ""
echo -e "  Then open ${BOLD}http://localhost:8400${RESET}"
echo ""

if [[ "$OLLAMA_INSTALLED" == "true" && -n "$OLLAMA_URL" ]]; then
  echo -e "  ${DIM}Make sure Ollama is running: ollama serve${RESET}"
fi

echo -e "  ${DIM}To update keys or config: ./setup.sh${RESET}"
echo -e "  ${DIM}To update a single secret: python3 -m backend.storage.setup_vault --data-dir data --set KEY=VALUE${RESET}"
echo ""
