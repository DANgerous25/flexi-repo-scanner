// ── Task States ──────────────────────────────────────────
export type TaskState = "inactive" | "scheduled" | "running" | "completed" | "failed" | "partial";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type ScanType = "pattern" | "llm-review" | "doc-coverage";
export type ScanMode = "full" | "diff";
export type ActionTrigger = "always" | "findings" | "fixed";

// ── Rules ────────────────────────────────────────────────
export interface PatternRule {
  id: string;
  name: string;
  pattern: string;
  severity: Severity;
  case_sensitive?: boolean;
  context_requires?: string;
}

export interface AllowlistEntry {
  file?: string;
  pattern?: string;
  match?: string;
  rules?: string[];
  reason: string;
}

export interface TaskAction {
  type: "email-report" | "generate-fix-prompt" | "github-issue" | "generate-prompt" | "in-app-notify";
  trigger: ActionTrigger;
  recipients?: string[];
  template?: string;
  output?: "file" | "clipboard" | "stdout";
  labels?: string[];
  assign?: string;
}

// ── Task ─────────────────────────────────────────────────
export interface Task {
  id: string;
  name: string;
  description: string;
  active: boolean;
  connection: string;
  state: TaskState;
  schedule: {
    cron: string;
    timezone: string;
  };
  scan: {
    mode: ScanMode;
    type: ScanType;
    paths: {
      include: string[];
      exclude: string[];
    };
    rules?: PatternRule[];
    llm?: {
      model: string;
      preferred_models?: string[];
      prompt_template?: string;
      prompt?: string;
      focus?: string[];
      max_files_per_run?: number;
    };
    allowlist?: AllowlistEntry[];
  };
  actions: TaskAction[];
  last_run?: string;
  next_run?: string;
  findings_count?: number;
  task_builder_prompt?: string;
}

// ── Connection ───────────────────────────────────────────
export interface Connection {
  id: string;
  name: string;
  owner: string;
  repo: string;
  default_branch: string;
  status: "connected" | "error" | "rate_limited";
  rate_limit_remaining?: number;
  rate_limit_reset?: string;
}

// ── Results ──────────────────────────────────────────────
export interface TaskRun {
  id: string;
  task_id: string;
  task_name: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
  status: "running" | "completed" | "failed" | "cancelled" | "partial";
  findings_count: number;
  scan_mode: ScanMode;
  scan_type: ScanType;
  error?: string;
}

export interface Finding {
  id: string;
  run_id: string;
  file: string;
  line?: number;
  severity: Severity;
  category: string;
  rule_id: string;
  rule_name: string;
  matched_text: string;
  context?: string;
}

// ── Benchmark ────────────────────────────────────────────
export interface BenchmarkResult {
  id: string;
  task_id: string;
  task_name: string;
  started_at: string;
  status: "running" | "completed" | "failed";
  models: BenchmarkModelResult[];
}

export interface BenchmarkModelResult {
  model: string;
  model_name: string;
  findings_count: number;
  unique_findings: number;
  estimated_false_positives: number;
  duration_seconds: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  status: "running" | "completed" | "failed";
}

// ── Settings ─────────────────────────────────────────────
export interface Settings {
  server: {
    host: string;
    port: number;
  };
  smtp: {
    host: string;
    port: number;
    tls: boolean;
    username: string;
    password: string;
    from_address: string;
    from_name: string;
  };
  llm: {
    providers: Record<string, LLMProvider>;
    default_model?: string;
    backup_model?: string;
  };
  retention: {
    results_days: number;
    max_days: number;
  };
}

export interface LLMProvider {
  api_key?: string;
  base_url?: string;
  models: LLMModel[];
}

export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  configured: boolean;
}

// ── Notification ─────────────────────────────────────────
export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  task_id?: string;
  run_id?: string;
  type: "findings" | "error" | "info";
}

// ── Dashboard ────────────────────────────────────────────
export interface DashboardStats {
  total_tasks: number;
  active_tasks: number;
  findings_today: number;
  unread_notifications: number;
  tasks: DashboardTask[];
  recent_runs: TaskRun[];
  failed_tasks: string[];
}

export interface DashboardTask {
  id: string;
  name: string;
  state: TaskState;
  scan_type: ScanType;
  last_run?: string;
  next_run?: string;
  findings_count: number;
  connection: string;
}
