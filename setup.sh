#!/usr/bin/env bash
set -euo pipefail

# ─── Flexi Repo Scanner — Interactive Setup ──────────────────────────────
# Walks you through everything: deps, config, API keys, first run.
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
  echo -ne "  ${prompt}: "
  read -rs input
  echo ""
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

# ─── Header ──────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║       Flexi Repo Scanner — Setup Wizard         ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  This will set up everything you need to run the scanner."
echo -e "  Press ${BOLD}Enter${RESET} to accept defaults. Skip any step you want."
echo ""

# ─── Step 1: Check Prerequisites ─────────────────────────────────────────

step "Checking prerequisites"

# Python
if command -v python3 &>/dev/null; then
  PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
  ok "Python $PY_VER"
else
  fail "Python 3 not found — install from https://python.org"
  exit 1
fi

# Node
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>&1)
  ok "Node.js $NODE_VER"
else
  fail "Node.js not found — install from https://nodejs.org"
  exit 1
fi

# Ollama
if command -v ollama &>/dev/null; then
  ok "Ollama installed"
  OLLAMA_INSTALLED=true
else
  warn "Ollama not found — LLM features will need cloud API keys"
  info "Install later: brew install ollama (macOS) or https://ollama.ai"
  OLLAMA_INSTALLED=false
fi

# Git
if command -v git &>/dev/null; then
  ok "Git $(git --version | awk '{print $3}')"
else
  fail "Git not found"
  exit 1
fi

# ─── Step 2: Install Dependencies ────────────────────────────────────────

step "Installing dependencies"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

info "Each repo you want to scan needs a GitHub connection."
info "You'll need a GitHub Personal Access Token (PAT) with repo read access."
echo ""

CONNECTIONS=""
CONN_COUNT=0

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

if [[ -n "$CONNECTIONS" ]]; then
  cat > config/connections.yaml <<EOF
connections:
${CONNECTIONS}
EOF
  ok "$CONN_COUNT connection(s) configured"
else
  warn "No connections configured — you can add them later in config/connections.yaml"
  cat > config/connections.yaml <<EOF
connections: []
EOF
fi

# GitHub token
echo ""
info "GitHub PAT is used for all connections (stored in .env, not in config files)."
if ask_yn "Enter your GitHub token now?" "y"; then
  ask_secret "  GitHub token (ghp_... or github_pat_...)" GH_TOKEN
  if [[ -n "$GH_TOKEN" ]]; then
    ok "Token received"
  fi
else
  GH_TOKEN=""
  warn "Skipped — set GITHUB_TOKEN in .env later"
fi

# ─── Step 4: LLM Providers ──────────────────────────────────────────────

step "LLM providers (for AI-powered code review & benchmarks)"

info "Pattern scanning (regex) works without any LLM keys."
info "LLM providers are only needed for AI code review and benchmarking."
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
  read -rs key
  echo ""

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
  fi
done

# Count configured
CONFIGURED_COUNT=0
[[ -n "$OLLAMA_URL" ]] && CONFIGURED_COUNT=$((CONFIGURED_COUNT + 1))
CONFIGURED_COUNT=$((CONFIGURED_COUNT + ${#PROVIDER_KEYS[@]}))

if [[ $CONFIGURED_COUNT -gt 0 ]]; then
  ok "${CONFIGURED_COUNT} LLM provider(s) configured"
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
  warn "Skipped — you can configure email later in config/settings.yaml"
fi

# ─── Step 6: Write Config Files ─────────────────────────────────────────

step "Writing configuration"

# .env file (export format so 'source .env' works)
cat > .env <<ENVEOF
# Flexi Repo Scanner — Environment Variables
# Generated by setup.sh on $(date -u +"%Y-%m-%d %H:%M UTC")
# Usage: source .env

# GitHub
export GITHUB_TOKEN="${GH_TOKEN}"

# SMTP
export SMTP_USERNAME="${SMTP_USERNAME}"
export SMTP_PASSWORD="${SMTP_PASSWORD}"
ENVEOF

# Add LLM provider keys to .env
for pname in "${!PROVIDER_KEYS[@]}"; do
  for entry in "${CLOUD_PROVIDERS[@]}"; do
    IFS='|' read -r name env_var _ _ <<< "$entry"
    if [[ "$name" == "$pname" ]]; then
      echo "export ${env_var}=\"${PROVIDER_KEYS[$pname]}\"" >> .env
      break
    fi
  done
done

ok ".env written (secrets stored here, gitignored)"

# settings.yaml
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
ok "config/connections.yaml written"

# ─── Step 7: Create Example Task ─────────────────────────────────────────

step "Scan tasks"

if [[ $CONN_COUNT -gt 0 ]]; then
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
else
  warn "No connections configured — add tasks after setting up connections"
fi

# ─── Summary ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║              Setup Complete                      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

echo -e "  ${BOLD}Files created:${RESET}"
echo -e "    .env                        ${DIM}← secrets (gitignored)${RESET}"
echo -e "    config/settings.yaml        ${DIM}← server, SMTP, LLM providers${RESET}"
echo -e "    config/connections.yaml     ${DIM}← GitHub repos${RESET}"
ls config/tasks/*.yaml 2>/dev/null | while read f; do
  echo -e "    ${f}  ${DIM}← scan task${RESET}"
done

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

echo -e "  ${DIM}To re-run setup: ./setup.sh${RESET}"
echo ""
