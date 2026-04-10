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
  Recipe,
} from "./types";

// ── Generic helpers ─────────────────────────────────────

function sanitizeString(str: string): string {
  return str.replace(/[^a-zA-Z0-9 .,_\-/:_?=&%]/g, "");
}

async function get<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", sanitizeString(url));
  return res.json();
}

async function post<T>(url: string, data?: unknown): Promise<T> {
  const sanitizedUrl = sanitizeString(url);
  const res = await apiRequest("POST", sanitizedUrl, data);
  return res.json();
}

async function put<T>(url: string, data?: unknown): Promise<T> {
  const sanitizedUrl = sanitizeString(url);
  const res = await apiRequest("PUT", sanitizedUrl, data);
  return res.json();
}

async function del<T = void>(url: string): Promise<T> {
  const res = await apiRequest("DELETE", url);
  if (res.status === 204) return undefined as T;
  return res.json();
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

export async function dismissFailedTaskAlert(taskId: string): Promise<void> {
  await post<void>(`/api/tasks/${encodeURIComponent(taskId)}/dismiss-alert`);
}

export async function copyTask(id: string): Promise<Task> {
  return post<Task>(`/api/tasks/${encodeURIComponent(id)}/copy`);
}

// ── Runs ────────────────────────────────────────────────

export async function cancelRun(runId: string): Promise<TaskRun> {
  const raw = await post<any>(`/api/runs/${encodeURIComponent(runId)}/cancel`);
  return normalizeRun(raw);
}

export async function stopRun(runId: string): Promise<TaskRun> {
  const raw = await post<any>(`/api/runs/${encodeURIComponent(runId)}/stop`);
  return normalizeRun(raw);
}

export async function deleteRun(runId: string): Promise<{ message: string; run_id: string }> {
  return del(`/api/runs/${encodeURIComponent(runId)}`);
}

export async function deleteAllTaskRuns(taskId: string): Promise<{ message: string; deleted_count: number }> {
  return del(`/api/runs/task/${encodeURIComponent(taskId)}/all`);
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
  const result = await post<{
    suggestions: string;
    parsed: Record<string, unknown>;
    model: string;
    tokens: { input: number; output: number };
    error?: string;
  }>("/api/tasks/generate", { mode, prompt, current_config: currentConfig });

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
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

export async function fetchOpenRouterModels(): Promise<{ id: string; name: string; pricing: Record<string, number> }[]> {
  const data = await get<{ models: { id: string; name: string; pricing: Record<string, number> }[] }>("/api/settings/openrouter-models");
  return data.models;
}

export async function setOpenRouterModel(modelId: string, modelName: string): Promise<{ message: string; model: string }> {
  return post<{ message: string; model: string }>("/api/settings/openrouter-model", { model_id: modelId, model_name: modelName });
}

export async function updateProviderApiKey(providerName: string, apiKey: string): Promise<{ message: string }> {
  return post<{ message: string }>("/api/settings/provider-api-key", { provider: providerName, api_key: apiKey });
}

export async function updateGitHubToken(token: string): Promise<{ message: string }> {
  return post<{ message: string }>("/api/settings/github-token", { token });
}

// ── Notifications ───────────────────────────────────────

export async function fetchNotifications(): Promise<Notification[]> {
  return get<Notification[]>("/api/notifications");
}

export async function markNotificationRead(id: number | string): Promise<void> {
  await post<unknown>(`/api/notifications/${encodeURIComponent(String(id))}/read`);
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

export async function analyzeFinding(data: {
  finding: any;
  file_content?: string;
  task_id?: string;
}): Promise<{
  analysis: string;
  model: string;
  tokens: { input: number; output: number };
}> {
  return post("/api/results/analyze", data);
}

// ── Recipes ──────────────────────────────────────────────

export async function fetchRecipes(): Promise<Recipe[]> {
  return get<Recipe[]>("/api/recipes");
}

export async function fetchRecipeDetail(recipeId: string): Promise<Recipe> {
  return get<Recipe>(`/api/recipes/${encodeURIComponent(recipeId)}`);
}

// ── Finding Management ─────────────────────────────────

export async function fetchOpenFindings(taskId?: string, limit?: number): Promise<Finding[]> {
  const params = new URLSearchParams();
  if (taskId) params.set("task_id", taskId);
  if (limit) params.set("limit", String(limit));
  params.set("status", "open");
  const qs = params.toString();
  return get<Finding[]>(`/api/results/findings${qs ? `?${qs}` : ""}`);
}

export async function fetchFindingsGrouped(
  groupBy: "file" | "rule" | "severity",
  taskId?: string,
): Promise<Record<string, any>[]> {
  const params = new URLSearchParams();
  params.set("group_by", groupBy);
  if (taskId) params.set("task_id", taskId);
  return get<Record<string, any>[]>(`/api/results/findings?${params.toString()}`);
}

export async function dismissFinding(
  findingId: number,
  reason: string = "",
): Promise<{ message: string }> {
  return post<{ message: string }>(
    `/api/results/findings/${findingId}/dismiss`,
    { reason },
  );
}

export async function reopenFinding(findingId: number): Promise<{ message: string }> {
  return post<{ message: string }>(`/api/results/findings/${findingId}/reopen`);
}

export async function requestFixForFinding(findingId: number): Promise<{ message: string }> {
  return post<{ message: string }>(`/api/results/findings/${findingId}/request-fix`);
}

export async function markFindingFixed(findingId: number): Promise<{ message: string }> {
  return post<{ message: string }>(`/api/results/findings/${findingId}/mark-fixed`);
}

export async function refineRule(data: {
  task_id: string;
  rule_id: string;
  finding_context?: string;
  prompt?: string;
}): Promise<{
  suggestions: string;
  parsed: {
    rules_to_modify?: Array<{ id: string; changes: Record<string, unknown> }>;
    allowlist_to_add?: Array<Record<string, unknown>>;
    raw?: string;
  };
  model: string;
  tokens: { input: number; output: number };
  current_rule: {
    id: string;
    name: string;
    pattern: string;
    severity: string;
    case_sensitive?: boolean;
    context_requires?: string;
  };
}> {
  return post("/api/results/refine-rule", data);
}

export async function applyRuleRefinement(
  taskId: string,
  modifications: Array<{ id: string; changes: Record<string, unknown> }>,
  allowlistAdditions: Array<Record<string, unknown>>,
): Promise<{ message: string; rules_modified: number; allowlist_added: number }> {
  return post(`/api/results/apply-rule-refinement?task_id=${encodeURIComponent(taskId)}`, {
    modifications,
    allowlist_additions: allowlistAdditions,
  });
}

export async function fetchSuppressedFindings(runId: string): Promise<Finding[]> {
  const raw = await get<any>(`/api/results/${encodeURIComponent(runId)}/findings`);
  const list = Array.isArray(raw) ? raw : (raw.findings ?? []);
  return list
    .filter((f: any) => f.status === "dismissed")
    .map(normalizeFinding);
}

export async function bulkSuppress(
  taskId: string,
  llmResponse: string,
): Promise<{
  message: string;
  allowlist_added: number;
  rules_refined: number;
  fixes_suggested: number;
  errors: string[];
}> {
  return post("/api/results/bulk-suppress", { task_id: taskId, llm_response: llmResponse });
}
