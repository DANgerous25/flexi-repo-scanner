import type {
  DashboardStats,
  Task,
  Connection,
  TaskRun,
  Finding,
  BenchmarkResult,
  Settings,
  Notification,
  LLMModel,
} from "./types";

export const mockDashboard: DashboardStats = {
  total_tasks: 5,
  active_tasks: 3,
  findings_today: 12,
  unread_notifications: 3,
  tasks: [
    { id: "pii-scan", name: "PII Scanner", state: "completed", scan_type: "pattern", last_run: "2026-03-31T00:15:00Z", next_run: "2026-04-01T01:00:00Z", findings_count: 8, connection: "my-project" },
    { id: "code-review", name: "Weekly Code Review", state: "scheduled", scan_type: "llm-review", last_run: "2026-03-24T02:00:00Z", next_run: "2026-03-31T02:00:00Z", findings_count: 4, connection: "my-project" },
    { id: "vuln-scan", name: "Vulnerability Scan", state: "failed", scan_type: "pattern", last_run: "2026-03-30T23:00:00Z", next_run: "2026-04-01T00:00:00Z", findings_count: 0, connection: "api-server" },
    { id: "doc-coverage", name: "Doc Coverage Check", state: "inactive", scan_type: "doc-coverage", findings_count: 0, connection: "my-project" },
    { id: "license-audit", name: "License Audit", state: "completed", scan_type: "llm-review", last_run: "2026-03-30T08:00:00Z", next_run: "2026-04-06T08:00:00Z", findings_count: 2, connection: "frontend-app" },
  ],
  recent_runs: [
    { id: "run-1", task_id: "pii-scan", task_name: "PII Scanner", started_at: "2026-03-31T00:15:00Z", completed_at: "2026-03-31T00:15:42Z", duration_seconds: 42, status: "completed", findings_count: 8, scan_mode: "full", scan_type: "pattern" },
    { id: "run-2", task_id: "vuln-scan", task_name: "Vulnerability Scan", started_at: "2026-03-30T23:00:00Z", completed_at: "2026-03-30T23:01:12Z", duration_seconds: 72, status: "failed", findings_count: 0, scan_mode: "full", scan_type: "pattern", error: "Connection rate limited" },
    { id: "run-3", task_id: "license-audit", task_name: "License Audit", started_at: "2026-03-30T08:00:00Z", completed_at: "2026-03-30T08:02:30Z", duration_seconds: 150, status: "completed", findings_count: 2, scan_mode: "full", scan_type: "llm-review" },
    { id: "run-4", task_id: "code-review", task_name: "Weekly Code Review", started_at: "2026-03-24T02:00:00Z", completed_at: "2026-03-24T02:03:20Z", duration_seconds: 200, status: "completed", findings_count: 4, scan_mode: "diff", scan_type: "llm-review" },
    { id: "run-5", task_id: "pii-scan", task_name: "PII Scanner", started_at: "2026-03-30T00:15:00Z", completed_at: "2026-03-30T00:15:38Z", duration_seconds: 38, status: "completed", findings_count: 6, scan_mode: "full", scan_type: "pattern" },
  ],
  failed_tasks: ["vuln-scan"],
};

export const mockTasks: Task[] = [
  {
    id: "pii-scan",
    name: "PII Scanner",
    description: "Scan for personal data, email addresses, and employer references",
    active: true,
    connection: "my-project",
    state: "completed",
    schedule: { cron: "0 8 * * *", timezone: "Asia/Hong_Kong" },
    scan: {
      mode: "full",
      type: "pattern",
      paths: { include: ["**/*.py", "**/*.md", "**/*.tsx"], exclude: ["node_modules/", "dist/"] },
      rules: [
        { id: "email-address", name: "Email Addresses", pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", severity: "high" },
        { id: "ai-authorship", name: "AI Tool Attribution", pattern: "\\b(claude code|vibe coding|copilot generated)\\b", severity: "critical", case_sensitive: false },
        { id: "hardcoded-secret", name: "Hardcoded API Key", pattern: "(?:api[_-]?key|api[_-]?secret)\\s*[=:]\\s*['\"][A-Za-z0-9+/=_-]{20,}['\"]", severity: "critical" },
      ],
      allowlist: [{ file: "CLAUDE.md", rules: ["ai-authorship"], reason: "Claude Code config file" }],
    },
    actions: [
      { type: "email-report", trigger: "findings", recipients: ["alerts@example.com"] },
      { type: "in-app-notify", trigger: "findings" },
    ],
    last_run: "2026-03-31T00:15:00Z",
    next_run: "2026-04-01T01:00:00Z",
    findings_count: 8,
  },
  {
    id: "code-review",
    name: "Weekly Code Review",
    description: "LLM-powered review of recently changed files",
    active: true,
    connection: "my-project",
    state: "scheduled",
    schedule: { cron: "0 10 * * 1", timezone: "UTC" },
    scan: {
      mode: "diff",
      type: "llm-review",
      paths: { include: ["**/*.py", "**/*.ts", "**/*.tsx"], exclude: ["**/test_*", "node_modules/"] },
      llm: { model: "anthropic/claude-sonnet-4-6", prompt_template: "code-review", focus: ["logic", "edge-cases", "error-handling"], max_files_per_run: 30 },
    },
    actions: [
      { type: "generate-prompt", trigger: "findings", template: "fix-instructions", output: "file" },
      { type: "email-report", trigger: "always", recipients: ["dev@example.com"] },
    ],
    last_run: "2026-03-24T02:00:00Z",
    next_run: "2026-03-31T02:00:00Z",
    findings_count: 4,
  },
  {
    id: "vuln-scan",
    name: "Vulnerability Scan",
    description: "Hybrid regex + LLM scan for security issues",
    active: true,
    connection: "api-server",
    state: "failed",
    schedule: { cron: "0 8 * * *", timezone: "UTC" },
    scan: {
      mode: "full",
      type: "pattern",
      paths: { include: ["**/*.py", "**/*.ts", "**/*.js"], exclude: ["node_modules/", "dist/"] },
      rules: [
        { id: "eval-usage", name: "eval() usage", pattern: "\\beval\\s*\\(", severity: "critical" },
        { id: "sql-injection", name: "Potential SQL Injection", pattern: "f['\"].*(?:SELECT|INSERT|UPDATE|DELETE).*\\{.*\\}", severity: "critical" },
      ],
    },
    actions: [{ type: "in-app-notify", trigger: "findings" }],
    last_run: "2026-03-30T23:00:00Z",
    next_run: "2026-04-01T00:00:00Z",
    findings_count: 0,
  },
  {
    id: "doc-coverage",
    name: "Doc Coverage Check",
    description: "Check documentation coverage across the codebase",
    active: false,
    connection: "my-project",
    state: "inactive",
    schedule: { cron: "0 6 * * 0", timezone: "UTC" },
    scan: { mode: "full", type: "doc-coverage", paths: { include: ["**/*.py", "**/*.ts"], exclude: ["node_modules/"] } },
    actions: [],
    findings_count: 0,
  },
  {
    id: "license-audit",
    name: "License Audit",
    description: "Check license compliance across dependencies",
    active: true,
    connection: "frontend-app",
    state: "completed",
    schedule: { cron: "0 8 * * 1", timezone: "UTC" },
    scan: {
      mode: "full",
      type: "llm-review",
      paths: { include: ["**/*"], exclude: ["node_modules/", "dist/"] },
      llm: { model: "openai/gpt-4.1-mini", prompt_template: "license-audit", max_files_per_run: 50 },
    },
    actions: [{ type: "email-report", trigger: "findings", recipients: ["legal@example.com"] }],
    last_run: "2026-03-30T08:00:00Z",
    next_run: "2026-04-06T08:00:00Z",
    findings_count: 2,
  },
];

export const mockConnections: Connection[] = [
  { id: "my-project", name: "My Project", owner: "falconar", repo: "my-project", default_branch: "main", status: "connected", rate_limit_remaining: 4850, rate_limit_reset: "2026-03-31T09:00:00Z" },
  { id: "api-server", name: "API Server", owner: "falconar", repo: "api-server", default_branch: "main", status: "error", rate_limit_remaining: 0, rate_limit_reset: "2026-03-31T08:30:00Z" },
  { id: "frontend-app", name: "Frontend App", owner: "falconar", repo: "frontend-app", default_branch: "develop", status: "connected", rate_limit_remaining: 4990, rate_limit_reset: "2026-03-31T09:00:00Z" },
];

export const mockRunHistory: TaskRun[] = [
  { id: "run-1", task_id: "pii-scan", task_name: "PII Scanner", started_at: "2026-03-31T00:15:00Z", completed_at: "2026-03-31T00:15:42Z", duration_seconds: 42, status: "completed", findings_count: 8, scan_mode: "full", scan_type: "pattern" },
  { id: "run-5", task_id: "pii-scan", task_name: "PII Scanner", started_at: "2026-03-30T00:15:00Z", completed_at: "2026-03-30T00:15:38Z", duration_seconds: 38, status: "completed", findings_count: 6, scan_mode: "full", scan_type: "pattern" },
  { id: "run-6", task_id: "pii-scan", task_name: "PII Scanner", started_at: "2026-03-29T00:15:00Z", completed_at: "2026-03-29T00:16:10Z", duration_seconds: 70, status: "partial", findings_count: 3, scan_mode: "full", scan_type: "pattern" },
  { id: "run-7", task_id: "pii-scan", task_name: "PII Scanner", started_at: "2026-03-28T00:15:00Z", completed_at: "2026-03-28T00:15:35Z", duration_seconds: 35, status: "completed", findings_count: 5, scan_mode: "full", scan_type: "pattern" },
];

export const mockFindings: Finding[] = [
  { id: "f-1", run_id: "run-1", file: "src/config/database.py", line: 42, severity: "critical", category: "Credentials", rule_id: "hardcoded-secret", rule_name: "Hardcoded API Key", matched_text: "api_key = \"sk-proj-abc123...\"" },
  { id: "f-2", run_id: "run-1", file: "src/utils/email.py", line: 15, severity: "high", category: "PII", rule_id: "email-address", rule_name: "Email Addresses", matched_text: "dan@falconar.co.uk" },
  { id: "f-3", run_id: "run-1", file: "src/utils/email.py", line: 28, severity: "high", category: "PII", rule_id: "email-address", rule_name: "Email Addresses", matched_text: "admin@internal.corp" },
  { id: "f-4", run_id: "run-1", file: "README.md", line: 5, severity: "critical", category: "AI Attribution", rule_id: "ai-authorship", rule_name: "AI Tool Attribution", matched_text: "Built with Claude Code" },
  { id: "f-5", run_id: "run-1", file: "docs/setup.md", line: 102, severity: "high", category: "PII", rule_id: "email-address", rule_name: "Email Addresses", matched_text: "john.smith@company.com" },
  { id: "f-6", run_id: "run-1", file: "src/auth/providers.ts", line: 78, severity: "critical", category: "Credentials", rule_id: "hardcoded-secret", rule_name: "Hardcoded API Key", matched_text: "access_token = \"ghp_xxxx...\"" },
  { id: "f-7", run_id: "run-1", file: "tests/fixtures/users.json", line: 3, severity: "high", category: "PII", rule_id: "email-address", rule_name: "Email Addresses", matched_text: "testuser@example.org" },
  { id: "f-8", run_id: "run-1", file: "src/services/notification.py", line: 55, severity: "high", category: "PII", rule_id: "email-address", rule_name: "Email Addresses", matched_text: "noreply@myapp.io" },
];

export const mockBenchmarks: BenchmarkResult[] = [
  {
    id: "bench-1",
    task_id: "code-review",
    task_name: "Weekly Code Review",
    started_at: "2026-03-29T14:00:00Z",
    status: "completed",
    models: [
      { model: "anthropic/claude-sonnet-4-6", model_name: "Claude Sonnet 4.5", findings_count: 12, unique_findings: 2, estimated_false_positives: 1, duration_seconds: 14.2, input_tokens: 24500, output_tokens: 3200, estimated_cost: 0.12, status: "completed" },
      { model: "openai/gpt-4.1-mini", model_name: "GPT-4.1 Mini", findings_count: 10, unique_findings: 1, estimated_false_positives: 3, duration_seconds: 11.8, input_tokens: 24500, output_tokens: 2800, estimated_cost: 0.04, status: "completed" },
      { model: "groq/llama-3.3-70b-versatile", model_name: "Llama 3.3 70B", findings_count: 8, unique_findings: 0, estimated_false_positives: 5, duration_seconds: 42.1, input_tokens: 24500, output_tokens: 4100, estimated_cost: 0.00, status: "completed" },
    ],
  },
];

export const mockSettings: Settings = {
  server: { host: "0.0.0.0", port: 8400 },
  smtp: { host: "smtp.gmail.com", port: 587, tls: true, username: "", password: "", from_address: "scanner@yourdomain.com", from_name: "Flexi Repo Scanner" },
  llm: {
    providers: {
      anthropic: { api_key: "sk-ant-***", models: [{ id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.5" }, { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" }] },
      openai: { api_key: "sk-***", models: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" }, { id: "openai/gpt-4.1", name: "GPT-4.1" }] },
      groq: { api_key: "", models: [{ id: "groq/llama-3.3-70b-versatile", name: "Llama 3.3 70B" }] },
      ollama: { base_url: "http://localhost:11434", models: [{ id: "ollama/qwen3:14b", name: "Qwen 3 14B (local)" }] },
    },
  },
  retention: { results_days: 30, max_days: 0 },
};

export const mockNotifications: Notification[] = [
  { id: "n-1", title: "PII Scanner completed", message: "Found 8 findings in my-project", timestamp: "2026-03-31T00:15:42Z", read: false, task_id: "pii-scan", run_id: "run-1", type: "findings" },
  { id: "n-2", title: "Vulnerability Scan failed", message: "Connection rate limited for api-server", timestamp: "2026-03-30T23:01:12Z", read: false, task_id: "vuln-scan", run_id: "run-2", type: "error" },
  { id: "n-3", title: "License Audit completed", message: "Found 2 findings in frontend-app", timestamp: "2026-03-30T08:02:30Z", read: false, task_id: "license-audit", run_id: "run-3", type: "findings" },
  { id: "n-4", title: "Weekly Code Review completed", message: "Found 4 findings in my-project", timestamp: "2026-03-24T02:03:20Z", read: true, task_id: "code-review", run_id: "run-4", type: "findings" },
  { id: "n-5", title: "PII Scanner completed", message: "Found 6 findings in my-project", timestamp: "2026-03-30T00:15:38Z", read: true, task_id: "pii-scan", run_id: "run-5", type: "findings" },
];

export const mockModels: LLMModel[] = [
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
  { id: "openai/gpt-4.1", name: "GPT-4.1" },
  { id: "groq/llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
  { id: "ollama/qwen3:14b", name: "Qwen 3 14B (local)" },
];
