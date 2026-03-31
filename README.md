# Flexi Repo Scanner

A self-hosted, LLM-powered code analysis platform with a web dashboard. Connects to GitHub repositories via API (no cloning), runs configurable scan tasks on schedules, and supports multiple LLM providers including local models via Ollama.

## Features

- **Pattern Scanning** — Regex-based detection for PII, credentials, AI authorship traces, and custom patterns
- **LLM Code Review** — Send code to any LLM for security review, quality analysis, and general review
- **Documentation Coverage** — Hybrid regex + LLM detection of missing docstrings and stale docs
- **Context-Aware Filtering** — Suppress false positives (e.g., LLM provider names used in configs vs. authorship)
- **Scheduled Scans** — Cron-based scheduling with full and diff modes
- **Multi-Provider LLM Support** — Anthropic, OpenAI, Groq, xAI, Mistral, DeepSeek, and Ollama (local)
- **Model Benchmarking** — Compare LLM performance side-by-side on the same task
- **Web Dashboard** — Manage tasks, browse results, configure settings from a clean UI
- **Multiple Actions** — Email reports, GitHub Issues, fix prompt generation, in-app notifications
- **Fix Prompt Generation** — Generates detailed fix instructions for Claude Code, Cursor, or similar tools
- **Copy-as-Template** — Duplicate any task config as a starting point for new scans
- **No Cloning** — All repo access via GitHub REST API
- **Fully Offline-Capable** — Use Ollama for LLMs and private repos via tokens

## Quick Start

```bash
# 1. Clone
git clone https://github.com/DANgerous25/flexi-repo-scanner.git
cd flexi-repo-scanner

# 2. Interactive setup — walks you through everything
./setup.sh
# Installs deps, asks for GitHub token, LLM API keys, SMTP config.
# Creates .env, config/settings.yaml, config/connections.yaml, and starter tasks.
# No manual file editing required.

# 3. Run
./run.sh
# → Server running at http://localhost:8400
```

## Configuration

All configuration lives in the `config/` directory (gitignored — never committed).

### Global Settings — `config/settings.yaml`

```yaml
server:
  host: "0.0.0.0"
  port: 8400

smtp:
  host: smtp.gmail.com
  port: 587
  tls: true
  username: "${SMTP_USER}"
  password: "${SMTP_PASS}"
  from_address: "scanner@yourdomain.com"

llm:
  fallback_order:       # Providers tried in sequence when a call fails
    - ollama            # Local models — free, no API key needed
    - groq              # Fast inference, generous free tier
    - deepseek          # Very cheap
    - anthropic         # Strong code analysis
    - openai            # Wide model range

  providers:
    ollama:
      base_url: "http://localhost:11434"
      models:
        - id: "ollama/qwen3:14b"
          name: "Qwen 3 14B (local)"
    anthropic:
      api_key: "${ANTHROPIC_API_KEY}"
      models:
        - id: "anthropic/claude-sonnet-4-6"
          name: "Claude Sonnet 4"

retention:
  results_days: 30
```

The `fallback_order` defines which provider to try next when one fails. Unset API keys (`${...}` with no matching env var) are automatically skipped.

Environment variables are interpolated at runtime — secrets live in `.env` (gitignored), never in config files.

### GitHub Connections — `config/connections.yaml`

```yaml
connections:
  - id: "my-project"
    name: "My Project"
    owner: "username"
    repo: "my-project"
    token: "${GITHUB_TOKEN}"
    default_branch: "main"
```

### Task Definitions — `config/tasks/<task-id>.yaml`

Each scan task is a YAML file. See `examples/tasks/` for templates covering:

| Example | Type | Description |
|---|---|---|
| `pii-scan` | Pattern | Email addresses, phone numbers, API keys, AI authorship |
| `code-review` | LLM Review | Weekly review of changed files |
| `vulnerability-scan` | Pattern | eval(), SQL injection, hardcoded secrets |
| `code-quality` | LLM Review | Complexity, duplication, error handling |
| `doc-coverage` | Doc Coverage | Missing docstrings and documentation |

## Task Types

### Pattern Scan
Pure regex scanning. Fast, deterministic, zero LLM cost.

```yaml
scan:
  type: "pattern"
  rules:
    - id: "email-address"
      name: "Email Address"
      pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
      severity: "high"
    - id: "employer-context"
      name: "Employer Reference"
      pattern: '\b(acme corp)\b'
      context_requires: '(employ|work|role|team)'
      severity: "high"
```

Features: case sensitivity, context-requires (only flag if surrounding text matches), allowlists, LLM provider context suppression.

### LLM Review
Sends code to an LLM for analysis. Built-in templates: `security-review`, `code-quality`, `code-review`, `doc-coverage`, `license-audit`.

```yaml
scan:
  type: "llm-review"
  llm:
    model: "anthropic/claude-sonnet-4-6"
    prompt_template: "security-review"
    focus: ["injection", "auth", "input-validation"]
    max_files_per_run: 50
```

### Doc Coverage
Hybrid: regex pass for missing docstrings + optional LLM review for accuracy.

## Actions

| Action | Description |
|---|---|
| `email-report` | SMTP email with formatted findings |
| `generate-fix-prompt` | Detailed fix instructions for Claude Code or similar |
| `github-issue` | Create a GitHub Issue with findings summary |
| `in-app-notify` | Dashboard notification with unread badge |

## Scan Modes

- **Full**: Scan all matching files in the repo
- **Diff**: Only scan files changed since the last run (via GitHub Compare API)

## Model Benchmarking

Compare how different LLMs perform on the same review task:

1. Select an LLM review task and 2–5 models
2. Run the benchmark
3. Compare: findings found, time taken, tokens used, estimated cost

## System Service

```bash
# Install as systemd service
sudo cp flexi-repo-scanner.service /etc/systemd/system/
sudo systemctl enable --now flexi-repo-scanner
```

## Tech Stack

| Component | Choice |
|---|---|
| Backend | Python 3.11+ / FastAPI |
| Scheduler | APScheduler 3.x |
| LLM Router | LiteLLM |
| Frontend | React 18 + Tailwind CSS + shadcn/ui |
| Database | SQLite |
| Config | YAML with `${ENV_VAR}` interpolation |
| GitHub Access | REST API via httpx |

## API Reference

All endpoints prefixed with `/api/`:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard` | Dashboard overview |
| GET/POST | `/tasks` | List/create tasks |
| GET/PUT/DELETE | `/tasks/:id` | Task CRUD |
| POST | `/tasks/:id/run` | Trigger manual run |
| POST | `/tasks/:id/copy` | Copy as template |
| POST | `/tasks/:id/toggle` | Activate/deactivate |
| GET | `/tasks/:id/results` | Run history |
| GET | `/results/recent` | Recent runs |
| GET | `/results/:runId/findings` | Findings for a run |
| GET | `/results/:runId/export/json` | Export as JSON |
| GET | `/results/:runId/export/csv` | Export as CSV |
| GET/POST | `/connections` | List/create connections |
| POST | `/connections/:id/test` | Test connection |
| GET/PUT | `/settings` | Settings management |
| POST | `/settings/test-smtp` | Test SMTP |
| POST | `/settings/test-llm/:model` | Test LLM model |
| GET | `/settings/models` | List configured models |
| POST | `/benchmarks` | Start benchmark |
| GET | `/benchmarks` | List benchmarks |
| GET | `/notifications` | Notification feed |

## Security

- No authentication — localhost only (single user, self-hosted)
- Secrets via environment variables or gitignored config files
- GitHub tokens stored locally, minimum scope: `repo` or `public_repo`
- No telemetry, fully offline-capable with Ollama

## License

MIT
