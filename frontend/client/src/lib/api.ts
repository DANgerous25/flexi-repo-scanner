import { apiRequest } from "./queryClient";
import type {
  Task,
  Connection,
  TaskRun,
  Finding,
  BenchmarkResult,
  Settings,
  Notification,
  LLMModel,
  DashboardStats,
} from "./types";

// ── Generic helpers ─────────────────────────────────────

async function get<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json();
}

async function post<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiRequest("POST", url, data);
  return res.json();
}

async function put<T>(url: string, data?: unknown): Promise<T> {
  const res = await apiRequest("PUT", url, data);
  return res.json();
}

async function del(url: string): Promise<void> {
  await apiRequest("DELETE", url);
}

// ── Dashboard ───────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardStats> {
  const data = await get<any>("/api/dashboard");
  return {
    total_tasks: data.stats?.total_tasks ?? 0,
    active_tasks: data.stats?.active_tasks ?? 0,
    findings_today: data.stats?.findings_today ?? 0,
    unread_notifications: data.stats?.unread_notifications ?? 0,
    tasks: data.tasks ?? [],
    recent_runs: data.recent_runs ?? [],
    failed_tasks: data.stats?.failed_tasks ?? data.failed_tasks ?? [],
  };
}

// ── Tasks ───────────────────────────────────────────────

function normalizeTask(raw: any): Task {
  return {
    ...raw,
    // API returns state as { status: "...", next_run_at, last_run_id }
    // Frontend expects state as a string
    state: typeof raw.state === "object" ? raw.state?.status ?? "inactive" : raw.state ?? "inactive",
    // API has next_run_at at top level and inside state
    next_run: raw.next_run_at ?? raw.state?.next_run_at ?? raw.next_run,
    // findings_count may not exist on list endpoint
    findings_count: raw.findings_count ?? raw.finding_count ?? 0,
  };
}

export async function fetchTasks(): Promise<Task[]> {
  const raw = await get<any[]>("/api/tasks");
  return raw.map(normalizeTask);
}

export async function fetchTask(id: string): Promise<Task> {
  const raw = await get<any>(`/api/tasks/${encodeURIComponent(id)}`);
  return normalizeTask(raw);
}

export async function createTask(config: Record<string, unknown>): Promise<Task> {
  return post<Task>("/api/tasks", { config });
}

export async function updateTask(id: string, config: Record<string, unknown>): Promise<Task> {
  return put<Task>(`/api/tasks/${encodeURIComponent(id)}`, { config });
}

export async function deleteTask(id: string): Promise<void> {
  return del(`/api/tasks/${encodeURIComponent(id)}`);
}

export async function toggleTask(id: string, active: boolean): Promise<void> {
  await post<unknown>(`/api/tasks/${encodeURIComponent(id)}/toggle`, { active });
}

export async function runTask(id: string): Promise<void> {
  await post<unknown>(`/api/tasks/${encodeURIComponent(id)}/run`);
}

export async function copyTask(id: string): Promise<Task> {
  return post<Task>(`/api/tasks/${encodeURIComponent(id)}/copy`);
}

function normalizeRun(r: any): TaskRun {
  return {
    ...r,
    findings_count: r.findings_count ?? r.finding_count ?? 0,
    error: r.error ?? r.error_message ?? undefined,
    duration_seconds: r.duration_seconds ?? (
      r.started_at && r.completed_at
        ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)
        : undefined
    ),
    task_name: r.task_name ?? r.task_id ?? "Unknown",
    scan_mode: r.scan_mode ?? "full",
    scan_type: r.scan_type ?? "pattern",
  };
}

function normalizeFinding(f: any): Finding {
  return {
    ...f,
    file: f.file ?? f.file_path ?? "",
    line: f.line ?? f.line_number ?? undefined,
    rule_name: f.rule_name ?? f.description ?? f.rule_id ?? "",
    matched_text: f.matched_text ?? "",
    category: f.category ?? "unknown",
    severity: f.severity ?? "medium",
    rule_id: f.rule_id ?? "",
    run_id: f.run_id ?? "",
  };
}

export async function fetchTaskResults(taskId: string): Promise<TaskRun[]> {
  const raw = await get<any[]>(`/api/tasks/${encodeURIComponent(taskId)}/results`);
  return raw.map(normalizeRun);
}

// ── Connections ─────────────────────────────────────────

export async function fetchConnections(): Promise<Connection[]> {
  return get<any[]>("/api/connections").then((list) =>
    list.map((c) => ({
      ...c,
      status: c.status ?? "untested",
      rate_limit_remaining: c.rate_limit_remaining,
      rate_limit_reset: c.rate_limit_reset,
    }))
  );
}

export async function createConnection(data: {
  id: string;
  name: string;
  owner: string;
  repo: string;
  token: string;
  default_branch: string;
}): Promise<Connection> {
  return post<Connection>("/api/connections", data);
}

export async function updateConnection(id: string, data: Record<string, unknown>): Promise<Connection> {
  return put<Connection>(`/api/connections/${encodeURIComponent(id)}`, data);
}

export async function deleteConnection(id: string): Promise<void> {
  return del(`/api/connections/${encodeURIComponent(id)}`);
}

export async function testConnection(id: string): Promise<{ success: boolean; message?: string }> {
  const raw = await post<any>(`/api/connections/${encodeURIComponent(id)}/test`);
  // Backend returns { ok: true, name, private, default_branch, rate_limit } on success
  // or { ok: false, error: "..." } on failure
  return {
    success: !!raw.ok,
    message: raw.ok ? `Connected to ${raw.name}` : (raw.error ?? "Connection failed"),
  };
}

// ── LLM Generate ────────────────────────────────────────

export async function generateRules(
  mode: "create" | "refine",
  prompt: string,
  currentConfig?: Record<string, unknown>
): Promise<{
  suggestions: string;
  parsed: Record<string, unknown>;
  model: string;
  tokens: { input: number; output: number };
}> {
  return post<{
    suggestions: string;
    parsed: Record<string, unknown>;
    model: string;
    tokens: { input: number; output: number };
  }>("/api/tasks/generate", { mode, prompt, current_config: currentConfig });
}

// ── Allowlist ────────────────────────────────────────────

export async function addToAllowlist(
  taskId: string,
  entries: Array<{ file?: string; pattern?: string; match?: string; rules?: string[]; reason: string }>
): Promise<{ allowlist: any[] }> {
  return post<{ allowlist: any[] }>(`/api/tasks/${encodeURIComponent(taskId)}/allowlist`, { entries });
}

// ── File Content ─────────────────────────────────────────

export async function fetchFileContent(
  connId: string,
  path: string,
  ref: string = "main"
): Promise<{ path: string; content: string; encoding: string; size: number; sha: string }> {
  const params = new URLSearchParams({ path, ref });
  return get<{ path: string; content: string; encoding: string; size: number; sha: string }>(
    `/api/connections/${encodeURIComponent(connId)}/file?${params.toString()}`
  );
}

// ── Results ─────────────────────────────────────────────

export async function fetchResults(): Promise<TaskRun[]> {
  const raw = await get<any[]>("/api/results");
  return (raw ?? []).map(normalizeRun);
}

export async function fetchRunFindings(runId: string): Promise<Finding[]> {
  const raw = await get<any>(`/api/results/${encodeURIComponent(runId)}/findings`);
  // Backend returns { run, findings, summary } — extract findings array
  const list = Array.isArray(raw) ? raw : (raw.findings ?? []);
  return list.map(normalizeFinding);
}

// ── Settings ────────────────────────────────────────────

export async function fetchSettings(): Promise<Settings> {
  return get<Settings>("/api/settings");
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  return put<Settings>("/api/settings", settings);
}

export async function testSmtp(): Promise<{ success: boolean; message?: string }> {
  return post<{ success: boolean; message?: string }>("/api/settings/test-smtp");
}

export async function testLlm(modelId: string): Promise<{ success: boolean; message?: string }> {
  return post<{ success: boolean; message?: string }>(`/api/settings/test-llm/${encodeURIComponent(modelId)}`);
}

export async function fetchModels(): Promise<LLMModel[]> {
  return get<LLMModel[]>("/api/settings/models");
}

// ── Notifications ───────────────────────────────────────

export async function fetchNotifications(): Promise<Notification[]> {
  return get<Notification[]>("/api/notifications");
}

export async function markNotificationRead(id: string): Promise<void> {
  await put<unknown>(`/api/notifications/${encodeURIComponent(id)}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await post<unknown>("/api/notifications/read-all");
}

// ── Benchmarks ──────────────────────────────────────────

export async function fetchBenchmarks(): Promise<BenchmarkResult[]> {
  return get<BenchmarkResult[]>("/api/benchmarks");
}

export async function startBenchmark(taskId: string, models: string[]): Promise<BenchmarkResult> {
  return post<BenchmarkResult>("/api/benchmarks", { task_id: taskId, models });
}
