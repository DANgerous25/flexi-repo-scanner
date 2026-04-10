import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SeverityBadge, RunStatusBadge, ScanTypeBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import {
  fetchTask,
  fetchTaskResults,
  fetchRunFindings,
  addToAllowlist,
  fetchFileContent,
  stopRun,
  deleteRun,
  deleteAllTaskRuns,
  analyzeFinding,
  refineRule,
  applyRuleRefinement,
  dismissFinding,
  bulkSuppress,
} from "@/lib/api";
import CodeViewer from "@/components/CodeViewer";
import type { Task, TaskRun, Finding, AllowlistEntry } from "@/lib/types";
import {
  FileJson,
  FileSpreadsheet,
  ArrowLeft,
  FileSearch,
  ChevronRight,
  AlertTriangle,
  ClipboardCopy,
  Check,
  ShieldOff,
  ShieldCheck,
  StopCircle,
  Brain,
  Filter,
  Wrench,
  Loader2,
  Trash2,
  Info,
  EyeOff,
  Upload,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

function safeFormat(dateStr: string | undefined, fmt: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "—" : format(d, fmt);
}

function safeRelative(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "" : formatDistanceToNow(d, { addSuffix: true });
}

function formatFindingsForLLM(task: Task, run: TaskRun, findings: Finding[]): string {
  const openFindings = findings.filter((f) => !f.status || f.status === "open");
  if (openFindings.length === 0) return "No open findings to review.";

  const lines: string[] = [];

  lines.push(`# Code Review Request — ${task.name}`);
  lines.push(`Repository: ${task.connection} | Scan: ${task.scan?.type ?? "pattern"} | Run: ${safeFormat(run.started_at, "yyyy-MM-dd HH:mm")}`);
  lines.push(`Total findings: ${openFindings.length}`);
  lines.push("");

  if (task.scan?.allowlist?.length) {
    lines.push("## Already Suppressed (skip these)");
    for (const entry of task.scan.allowlist) {
      const scope = entry.file ? `file=${entry.file}` : entry.match ? `match="${entry.match}"` : entry.pattern ? `pattern=${entry.pattern}` : `rules=${(entry.rules || []).join(",")}`;
      lines.push(`- ${scope} — ${entry.reason || "no reason"}`);
    }
    lines.push("");
  }

  lines.push("## Findings to Review");
  lines.push("");
  for (let i = 0; i < openFindings.length; i++) {
    const f = openFindings[i];
    lines.push(`[${i + 1}] ${f.rule_name || f.rule_id} | ${f.severity} | ${f.file}:${f.line ?? "—"}`);
    lines.push(`    matched: ${f.matched_text}`);
    if (f.context) {
      lines.push(`    context: ${f.context.split("\n").slice(0, 3).join(" | ")}`);
    }
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push("");
  lines.push("For EACH finding, decide one action: `suppress` or `fix` or `refine_rule`.");
  lines.push("");
  lines.push("- **suppress**: False positive or acceptable risk. Add to allowlist.");
  lines.push("- **fix**: True positive worth fixing. Describe the specific code change.");
  lines.push("- **refine_rule**: Rule is too broad, suggest a regex or context_requires change.");
  lines.push("");
  lines.push("Respond with ONLY a JSON array. No markdown, no explanation outside the JSON.");
  lines.push("Format:");
  lines.push("```json");
  lines.push("[");
  lines.push("  {");
  lines.push('    "index": 1,');
  lines.push('    "action": "suppress",');
  lines.push('    "reason": "why this is a false positive",');
  lines.push('    "suppress_scope": "match|file|rule",');
  lines.push('    "suppress_file": "path/to/file (if scope=file)",');
  lines.push('    "suppress_match": "exact text (if scope=match)",');
  lines.push('    "suppress_rules": ["rule-id"] (if scope=rule)');
  lines.push("  },");
  lines.push("  {");
  lines.push('    "index": 2,');
  lines.push('    "action": "fix",');
  lines.push('    "reason": "why this needs fixing",');
  lines.push('    "suggested_fix": "specific code change"');
  lines.push("  },");
  lines.push("  {");
  lines.push('    "index": 3,');
  lines.push('    "action": "refine_rule",');
  lines.push('    "reason": "why the rule is too broad",');
  lines.push('    "rule_id": "the-rule-id",');
  lines.push('    "suggested_pattern": "improved regex (optional)",');
  lines.push('    "suggested_context_requires": "required context keywords (optional)"');
  lines.push("  }");
  lines.push("]");
  lines.push("```");
  lines.push("");
  lines.push("Respond with ONLY the JSON array. No other text.");

  return lines.join("\n");
}

export default function TaskResults() {
  const params = useParams();
  const taskId = params?.id ?? null;
  const [, setLocation] = useLocation();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"none" | "category" | "severity">("none");
  const [copied, setCopied] = useState(false);
  const [allowlistedIds, setAllowlistedIds] = useState<Set<number>>(new Set());
  const [codeViewerOpen, setCodeViewerOpen] = useState(false);
  const [codeViewerFile, setCodeViewerFile] = useState("");
  const [codeViewerLine, setCodeViewerLine] = useState<number | undefined>();
  const [codeViewerContent, setCodeViewerContent] = useState<string | null>(null);
  const [codeViewerLoading, setCodeViewerLoading] = useState(false);
  const [codeViewerError, setCodeViewerError] = useState<string | undefined>();
  const [stopping, setStopping] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [currentAnalysisData, setCurrentAnalysisData] = useState<any>(null);
  const [currentFinding, setCurrentFinding] = useState<Finding | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refineResult, setRefineResult] = useState<any>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineApplying, setRefineApplying] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [suppressedInfoOpen, setSuppressedInfoOpen] = useState(false);
  const [suppressedInfoFinding, setSuppressedInfoFinding] = useState<Finding | null>(null);
  const [suppressedAnalysis, setSuppressedAnalysis] = useState<any>(null);
  const [suppressedAnalysisLoading, setSuppressedAnalysisLoading] = useState(false);
  const [deleteRunAlertOpen, setDeleteRunAlertOpen] = useState(false);
  const [deleteRunTarget, setDeleteRunTarget] = useState<string | null>(null);
  const [deleteAllAlertOpen, setDeleteAllAlertOpen] = useState(false);
  const [bulkSuppressOpen, setBulkSuppressOpen] = useState(false);
  const [bulkSuppressText, setBulkSuppressText] = useState("");
  const [bulkSuppressApplying, setBulkSuppressApplying] = useState(false);
  const [bulkSuppressResult, setBulkSuppressResult] = useState<any>(null);
  const findingsSectionRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: analyzeFinding,
    onSuccess: (data) => {
      setCurrentAnalysisData(data);
      setAnalysisOpen(true);
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
      setCurrentAnalysisData({ analysis: "Error: " + err.message });
    },
  });

  const { data: task, isLoading: taskLoading } = useQuery<Task>({
    queryKey: [`/api/tasks/${taskId}`],
    queryFn: () => fetchTask(taskId!),
    enabled: !!taskId,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<TaskRun[]>({
    queryKey: [`/api/tasks/${taskId}/results`],
    queryFn: () => fetchTaskResults(taskId!),
    enabled: !!taskId,
  });

  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : runs[0];

  const { data: findings = [] } = useQuery<Finding[]>({
    queryKey: [`/api/results/${selectedRun?.id}/findings`],
    queryFn: () => fetchRunFindings(selectedRun!.id),
    enabled: !!selectedRun?.id,
  });

  const openFindings = findings.filter((f) => !f.status || f.status === "open");
  const suppressedFindings = findings.filter((f) => f.status === "dismissed");
  const displayedFindings = showSuppressed ? findings : openFindings;

  useEffect(() => {
    if (selectedRun?.id) {
      findingsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedRun?.id]);

  const groupedFindings = (() => {
    if (groupBy === "none") return { "All Findings": displayedFindings };
    const groups: Record<string, typeof displayedFindings> = {};
    displayedFindings.forEach((f) => {
      const key = groupBy === "category" ? f.category : f.severity;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });
    return groups;
  })();

  const handleAskLLM = async (finding: Finding) => {
    if (!task) return;
    setCurrentFinding(finding);
    setCurrentAnalysisData({ analysis: "Analyzing with LLM..." });
    setAnalysisOpen(true);
    try {
      const fileRes = await fetchFileContent(task.connection, finding.file);
      analyzeMutation.mutate({
        finding,
        file_content: fileRes.content,
        task_id: taskId || "",
      });
    } catch (err: any) {
      setCurrentAnalysisData({ analysis: "Failed to load file context: " + err.message });
    }
  };

  const handleRefineRule = async (finding: Finding) => {
    if (!task || !taskId) return;
    setCurrentFinding(finding);
    setRefinePrompt("");
    setRefineResult(null);
    setRefineOpen(true);
  };

  const submitRefine = async () => {
    if (!currentFinding || !taskId) return;
    setRefineLoading(true);
    try {
      const ctx = `File: ${currentFinding.file}\nLine: ${currentFinding.line ?? "—"}\nMatched text: ${currentFinding.matched_text}\nSeverity: ${currentFinding.severity}\nRule: ${currentFinding.rule_name} (${currentFinding.rule_id})\n${currentFinding.context ? `Context:\n${currentFinding.context}` : ""}`;
      const result = await refineRule({
        task_id: taskId,
        rule_id: currentFinding.rule_id,
        finding_context: ctx,
        prompt: refinePrompt || "Reduce false positives like this one",
      });
      setRefineResult(result);
    } catch (err: any) {
      toast({ title: "Refinement failed", description: err.message, variant: "destructive" });
      setRefineResult({ error: err.message });
    } finally {
      setRefineLoading(false);
    }
  };

  const handleApplyRefinement = async () => {
    if (!refineResult?.parsed || !taskId) return;
    setRefineApplying(true);
    try {
      const mods = refineResult.parsed.rules_to_modify ?? [];
      const allowlist = refineResult.parsed.allowlist_to_add ?? [];
      if (mods.length === 0 && allowlist.length === 0) {
        toast({ title: "Nothing to apply", description: "No rule modifications or allowlist additions suggested." });
        setRefineApplying(false);
        return;
      }
      await applyRuleRefinement(taskId, mods, allowlist);
      toast({ title: "Refinement applied", description: `${mods.length} rule(s) modified, ${allowlist.length} allowlist entry(ies) added.` });
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}`] });
      setRefineOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to apply refinement", description: err.message, variant: "destructive" });
    } finally {
      setRefineApplying(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    try {
      await deleteRun(runId);
      toast({ title: "Run deleted" });
      if (selectedRunId === runId) setSelectedRunId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}/results`] });
    } catch (err: any) {
      toast({ title: "Failed to delete run", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteAllRuns = async () => {
    if (!taskId) return;
    try {
      const result = await deleteAllTaskRuns(taskId);
      toast({ title: "All runs deleted", description: `${result.deleted_count} runs removed` });
      setSelectedRunId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}/results`] });
    } catch (err: any) {
      toast({ title: "Failed to delete runs", description: err.message, variant: "destructive" });
    }
    setDeleteAllAlertOpen(false);
  };

  const handleBulkSuppress = async () => {
    if (!taskId || !bulkSuppressText.trim()) return;
    setBulkSuppressApplying(true);
    try {
      const result = await bulkSuppress(taskId, bulkSuppressText);
      setBulkSuppressResult(result);
      if (result.allowlist_added > 0 || result.rules_refined > 0) {
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}`] });
      }
    } catch (err: any) {
      toast({ title: "Bulk suppress failed", description: err.message, variant: "destructive" });
      setBulkSuppressResult({ errors: [err.message] });
    } finally {
      setBulkSuppressApplying(false);
    }
  };

  const handleSuppressedInfo = (finding: Finding) => {
    setSuppressedInfoFinding(finding);
    setSuppressedAnalysis(null);
    setSuppressedInfoOpen(true);
  };

  const handleSuppressedLLMExplain = async () => {
    if (!suppressedInfoFinding || !task) return;
    setSuppressedAnalysisLoading(true);
    try {
      const fileRes = await fetchFileContent(task.connection, suppressedInfoFinding.file);
      const result = await analyzeFinding({
        finding: suppressedInfoFinding,
        file_content: fileRes.content,
        task_id: taskId || "",
      });
      setSuppressedAnalysis(result);
    } catch (err: any) {
      setSuppressedAnalysis({ analysis: "Error: " + err.message });
    } finally {
      setSuppressedAnalysisLoading(false);
    }
  };

  const getAllowlistMatchForFinding = (finding: Finding): AllowlistEntry | null => {
    if (!task?.scan?.allowlist) return null;
    for (const entry of task.scan.allowlist) {
      if (entry.rules?.length && !entry.file && !entry.match && !entry.pattern) {
        if (entry.rules.includes(finding.rule_id)) return entry;
      }
      if (entry.file && (finding.file.endsWith(entry.file) || finding.file === entry.file)) {
        if (!entry.rules?.length || entry.rules.includes(finding.rule_id)) return entry;
      }
      if (entry.match && finding.matched_text.includes(entry.match)) {
        if (!entry.rules?.length || entry.rules.includes(finding.rule_id)) return entry;
      }
    }
    return null;
  };

  if (taskLoading || runsLoading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[200px] rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Task not found</p>
        <Button
          variant="ghost"
          className="mt-2 text-xs"
          onClick={() => setLocation("/tasks")}
        >
          Back to Tasks
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid="button-back"
            onClick={() => setLocation("/tasks")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">{task.name}</h2>
              <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/30 text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                Allowlist: {task.scan?.allowlist?.length ?? 0} {(task.scan?.allowlist?.length ?? 0) === 1 ? "entry" : "entries"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{task.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedRun?.status === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              data-testid="button-stop-run"
              disabled={stopping}
              onClick={async () => {
                setStopping(true);
                try {
                  await stopRun(selectedRun.id);
                  toast({ title: "Run stopped", description: "The scan run has been stopped." });
                  queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}/results`] });
                } catch (err: any) {
                  toast({ title: "Failed to stop run", description: err.message, variant: "destructive" });
                } finally {
                  setStopping(false);
                }
              }}
            >
              <StopCircle className="w-3.5 h-3.5" />
              {stopping ? "Stopping…" : "Stop Run"}
            </Button>
          )}
        </div>
      </div>

      {/* Run History */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Run History</CardTitle>
            {runs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={() => setDeleteAllAlertOpen(true)}
              >
                <Trash2 className="w-3 h-3" />
                Delete All
              </Button>
            )}
          </div>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Timestamp</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Duration</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">Findings</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Mode</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                  No runs yet.
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => (
                <TableRow
                  key={run.id}
                  className={`border-border cursor-pointer transition-colors ${selectedRun?.id === run.id ? "bg-primary/5" : "hover:bg-muted/30"}`}
                  onClick={() => setSelectedRunId(run.id)}
                  data-testid={`row-run-${run.id}`}
                >
                  <TableCell>
                    <div className="text-sm text-foreground">{safeFormat(run.started_at, "MMM d, HH:mm")}</div>
                    <div className="text-[11px] text-muted-foreground">{safeRelative(run.started_at)}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{run.duration_seconds ? `${run.duration_seconds}s` : "—"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <RunStatusBadge status={run.status} reason={run.error} />
                      {run.error && (
                        <p className="text-[10px] text-red-400/80 truncate max-w-[200px]" title={run.error}>
                          {run.error}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {run.findings_count > 0 ? (
                      <span className="text-sm font-medium text-cyan-400">{run.findings_count}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground/50">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground capitalize">{run.scan_mode}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-red-400"
                        title="Delete run"
                        onClick={() => {
                          setDeleteRunTarget(run.id);
                          setDeleteRunAlertOpen(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <ChevronRight className={`w-4 h-4 transition-colors ${selectedRun?.id === run.id ? "text-primary" : "text-muted-foreground/30"}`} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Delete single run confirmation */}
      <AlertDialog open={deleteRunAlertOpen} onOpenChange={setDeleteRunAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this run and all its findings. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteRunTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deleteRunTarget) handleDeleteRun(deleteRunTarget);
                setDeleteRunTarget(null);
                setDeleteRunAlertOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete all runs confirmation */}
      <AlertDialog open={deleteAllAlertOpen} onOpenChange={setDeleteAllAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all runs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {runs.length} run(s) and their findings for this task. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDeleteAllRuns}
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Findings Detail */}
      {selectedRun && (
        <Card ref={findingsSectionRef} className="bg-card border-card-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm font-semibold">
                  Findings — {safeFormat(selectedRun.started_at, "MMM d, HH:mm")}
                </CardTitle>
                <Badge variant="outline" className="text-xs">{openFindings.length} open</Badge>
                {suppressedFindings.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={showSuppressed}
                      onCheckedChange={setShowSuppressed}
                      className="h-4 w-7 data-[state=checked]:bg-amber-500"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Show suppressed ({suppressedFindings.length})
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {openFindings.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-7 text-xs gap-1.5 transition-colors ${
                      copied ? "border-emerald-500/50 text-emerald-400" : ""
                    }`}
                    data-testid="button-copy-llm"
                    onClick={() => {
                      const md = formatFindingsForLLM(task, selectedRun, findings);
                      navigator.clipboard.writeText(md).then(() => {
                        setCopied(true);
                        toast({ title: "Copied to clipboard", description: `${openFindings.length} findings formatted for LLM review` });
                        setTimeout(() => setCopied(false), 2500);
                      });
                    }}
                  >
                    {copied ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <ClipboardCopy className="w-3 h-3" />
                    )}
                    {copied ? "Copied" : "Copy for LLM"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={() => {
                    setBulkSuppressOpen(true);
                    setBulkSuppressText("");
                    setBulkSuppressResult(null);
                  }}
                >
                  <Upload className="w-3 h-3" />
                  Apply LLM Response
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  data-testid="button-export-json"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = `/api/results/${encodeURIComponent(selectedRun.id)}/export/json`;
                    a.download = `findings-${selectedRun.id}.json`;
                    a.click();
                  }}
                >
                  <FileJson className="w-3 h-3" /> JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  data-testid="button-export-csv"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = `/api/results/${encodeURIComponent(selectedRun.id)}/export/csv`;
                    a.download = `findings-${selectedRun.id}.csv`;
                    a.click();
                  }}
                >
                  <FileSpreadsheet className="w-3 h-3" /> CSV
                </Button>
                <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
                  <SelectTrigger className="w-36 h-7 text-xs bg-background border-border" data-testid="select-group-by">
                    <SelectValue placeholder="Group by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No grouping</SelectItem>
                    <SelectItem value="category">By Category</SelectItem>
                    <SelectItem value="severity">By Severity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          {displayedFindings.length === 0 ? (
            <CardContent>
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <FileSearch className="w-6 h-6 mb-2" />
                <p className="text-sm">{showSuppressed ? "No findings in this run." : "No open findings in this run."}</p>
              </div>
            </CardContent>
          ) : (
            Object.entries(groupedFindings).map(([group, items]) => (
              <div key={group}>
                {groupBy !== "none" && (
                  <div className="px-4 py-2 bg-muted/30 border-t border-border">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group}</span>
                    <Badge variant="outline" className="ml-2 text-[10px]">{items.length}</Badge>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">File</TableHead>
                      <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider w-16">Line</TableHead>
                      <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Severity</TableHead>
                      <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Rule</TableHead>
                      <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Matched Text</TableHead>
                      <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((finding) => {
                      const isSuppressed = finding.status === "dismissed";
                      return (
                      <TableRow
                        key={finding.id}
                        className={`border-border ${isSuppressed ? "opacity-50" : ""}`}
                        data-testid={`row-finding-${finding.id}`}
                      >
                        <TableCell>
                          <button
                            className="text-xs font-code text-cyan-400 hover:underline cursor-pointer bg-transparent border-none p-0 text-left"
                            onClick={() => {
                              if (!task) return;
                              setCodeViewerFile(finding.file);
                              setCodeViewerLine(finding.line);
                              setCodeViewerContent(null);
                              setCodeViewerError(undefined);
                              setCodeViewerLoading(true);
                              setCodeViewerOpen(true);
                              fetchFileContent(task.connection, finding.file)
                                .then((res) => {
                                  setCodeViewerContent(res.content);
                                  setCodeViewerLoading(false);
                                })
                                .catch((err) => {
                                  setCodeViewerError(err.message || "Failed to load file");
                                  setCodeViewerLoading(false);
                                });
                            }}
                          >
                            {finding.file}
                          </button>
                          {isSuppressed && (
                            <Badge variant="outline" className="ml-2 text-[9px] border-amber-500/30 text-amber-400">suppressed</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-code text-muted-foreground">{finding.line ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={finding.severity} />
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{finding.rule_name}</span>
                        </TableCell>
                        <TableCell>
                          <code className="text-[11px] font-code text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded max-w-[300px] truncate inline-block">
                            {finding.matched_text}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {isSuppressed ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-amber-400 hover:text-amber-300"
                                title="Why suppressed?"
                                onClick={() => handleSuppressedInfo(finding)}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <>
                                <AllowlistPopover
                                  finding={finding}
                                  taskId={taskId!}
                                  onAllowlisted={() => {
                                    setAllowlistedIds((prev) => new Set([...Array.from(prev), finding.id]));
                                    queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}`] });
                                  }}
                                />
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      title="LLM actions"
                                    >
                                      <Brain className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuItem onClick={() => handleAskLLM(finding)}>
                                      <Brain className="w-4 h-4 mr-2" />
                                      Analyze Finding
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRefineRule(finding)}>
                                      <Filter className="w-4 h-4 mr-2" />
                                      Refine / Suppress Rule
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </Card>
      )}

      <CodeViewer
        open={codeViewerOpen}
        onOpenChange={setCodeViewerOpen}
        filePath={codeViewerFile}
        line={codeViewerLine}
        content={codeViewerContent}
        loading={codeViewerLoading}
        error={codeViewerError}
      />

      {/* LLM Analysis Dialog */}
      <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-4 h-4" />
              LLM Analysis: {currentFinding?.file || "Finding"} (model: {currentAnalysisData?.model || 'unknown'})
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="text-sm whitespace-pre-wrap font-light leading-relaxed border-l-2 border-muted pl-4 py-2 bg-muted/50 rounded">
              {typeof currentAnalysisData?.analysis === 'string'
                ? currentAnalysisData.analysis
                : JSON.stringify(currentAnalysisData?.analysis, null, 2) || "Analyzing with LLM..."}
            </div>
            {currentAnalysisData && (
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const text = typeof currentAnalysisData.analysis === 'string'
                      ? currentAnalysisData.analysis
                      : JSON.stringify(currentAnalysisData, null, 2);
                    navigator.clipboard.writeText(text);
                    toast({ title: "Copied analysis to clipboard" });
                  }}
                >
                  Copy Analysis
                </Button>
                {currentAnalysisData.analysis && typeof currentAnalysisData.analysis === 'object' && currentAnalysisData.analysis.suggested_fix_prompt && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(currentAnalysisData.analysis.suggested_fix_prompt);
                      toast({ title: "Copied fix prompt to clipboard" });
                    }}
                  >
                    Copy Fix Prompt
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Refine Rule Dialog */}
      <Dialog open={refineOpen} onOpenChange={setRefineOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Refine Rule: {currentFinding?.rule_name || currentFinding?.rule_id || "Rule"}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {currentFinding && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3 space-y-1">
                <div><span className="font-medium">Rule:</span> {currentFinding.rule_name} ({currentFinding.rule_id})</div>
                <div><span className="font-medium">File:</span> {currentFinding.file}:{currentFinding.line ?? "—"}</div>
                <div><span className="font-medium">Matched:</span> <code className="text-amber-400/90">{currentFinding.matched_text}</code></div>
              </div>
            )}

            {refineResult?.current_rule && (
              <div className="text-xs border rounded p-3 space-y-1">
                <p className="font-medium text-muted-foreground mb-1">Current Rule</p>
                <div><span className="text-muted-foreground">Pattern:</span> <code className="text-cyan-400 font-code">{refineResult.current_rule.pattern}</code></div>
                {refineResult.current_rule.context_requires && (
                  <div><span className="text-muted-foreground">Context requires:</span> <code className="text-cyan-400 font-code">{refineResult.current_rule.context_requires}</code></div>
                )}
                <div><span className="text-muted-foreground">Severity:</span> {refineResult.current_rule.severity}</div>
              </div>
            )}

            {!refineResult && (
              <>
                <Textarea
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  placeholder={'e.g. "Don\'t match version numbers like 10.13.0" or "Add context_requires to filter out non-networking IPs"'}
                  className="min-h-[80px] text-sm"
                  disabled={refineLoading}
                />
                <Button
                  onClick={submitRefine}
                  disabled={refineLoading}
                  className="w-full"
                >
                  {refineLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Getting LLM suggestions...
                    </>
                  ) : (
                    <>
                      <Brain className="w-4 h-4 mr-2" />
                      Suggest Refinements
                    </>
                  )}
                </Button>
              </>
            )}

            {refineResult && !refineResult.error && (
              <>
                <div className="text-sm whitespace-pre-wrap font-light leading-relaxed border-l-2 border-cyan-500/50 pl-4 py-2 bg-cyan-500/5 rounded">
                  {refineResult.suggestions}
                </div>

                {(refineResult.parsed?.rules_to_modify?.length > 0 || refineResult.parsed?.allowlist_to_add?.length > 0) && (
                  <div className="border rounded p-3 space-y-2">
                    <p className="text-xs font-semibold text-foreground">Structured Changes</p>
                    {refineResult.parsed.rules_to_modify?.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Rule modifications: {refineResult.parsed.rules_to_modify.length}</p>
                        {refineResult.parsed.rules_to_modify.map((mod: any, i: number) => (
                          <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1 font-code">
                            {mod.id}: {Object.entries(mod.changes || {}).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                          </div>
                        ))}
                      </div>
                    )}
                    {refineResult.parsed.allowlist_to_add?.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Allowlist additions: {refineResult.parsed.allowlist_to_add.length}</p>
                        {refineResult.parsed.allowlist_to_add.map((entry: any, i: number) => (
                          <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1">
                            {entry.reason || entry.match || entry.file || JSON.stringify(entry)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(refineResult.suggestions);
                      toast({ title: "Copied suggestions to clipboard" });
                    }}
                  >
                    <ClipboardCopy className="w-3.5 h-3.5 mr-1.5" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRefineResult(null);
                      setRefinePrompt("");
                    }}
                    disabled={refineLoading}
                  >
                    Try Again
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyRefinement}
                    disabled={refineApplying || (!refineResult.parsed?.rules_to_modify?.length && !refineResult.parsed?.allowlist_to_add?.length)}
                  >
                    {refineApplying ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <Wrench className="w-3.5 h-3.5 mr-1.5" />
                        Apply Changes
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            {refineResult?.error && (
              <div className="text-sm text-red-400 border-l-2 border-red-500/50 pl-4 py-2 bg-red-500/5 rounded">
                {refineResult.error}
              </div>
            )}

            {refineResult && (
              <p className="text-[10px] text-muted-foreground">
                Model: {refineResult.model || "unknown"} | Tokens: {refineResult.tokens?.input ?? 0} in / {refineResult.tokens?.output ?? 0} out
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Suppressed Finding Info Dialog */}
      <Dialog open={suppressedInfoOpen} onOpenChange={setSuppressedInfoOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <EyeOff className="w-4 h-4" />
              Suppressed Finding: {suppressedInfoFinding?.rule_name || suppressedInfoFinding?.rule_id}
            </DialogTitle>
          </DialogHeader>
          {suppressedInfoFinding && (
            <div className="mt-4 space-y-4">
              <div className="text-xs bg-muted/50 rounded p-3 space-y-1">
                <div><span className="font-medium">File:</span> {suppressedInfoFinding.file}:{suppressedInfoFinding.line ?? "—"}</div>
                <div><span className="font-medium">Matched:</span> <code className="text-amber-400/90">{suppressedInfoFinding.matched_text}</code></div>
                <div><span className="font-medium">Dismissed:</span> {suppressedInfoFinding.dismissed_reason || "No reason recorded"}</div>
                {suppressedInfoFinding.dismissed_at && (
                  <div><span className="font-medium">At:</span> {safeFormat(suppressedInfoFinding.dismissed_at, "MMM d, HH:mm")}</div>
                )}
              </div>

              {(() => {
                const match = getAllowlistMatchForFinding(suppressedInfoFinding);
                if (!match) return null;
                return (
                  <div className="text-xs border rounded p-3 space-y-1">
                    <p className="font-medium text-muted-foreground mb-1">Matching Allowlist Entry</p>
                    {match.rules?.length && (
                      <div><span className="text-muted-foreground">Rules:</span> {match.rules.join(", ")}</div>
                    )}
                    {match.file && (
                      <div><span className="text-muted-foreground">File:</span> <code className="text-cyan-400 font-code">{match.file}</code></div>
                    )}
                    {match.match && (
                      <div><span className="text-muted-foreground">Match:</span> <code className="text-cyan-400 font-code">{match.match}</code></div>
                    )}
                    {match.pattern && (
                      <div><span className="text-muted-foreground">Pattern:</span> <code className="text-cyan-400 font-code">{match.pattern}</code></div>
                    )}
                    {match.reason && (
                      <div><span className="text-muted-foreground">Reason:</span> {match.reason}</div>
                    )}
                  </div>
                );
              })()}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSuppressedLLMExplain}
                  disabled={suppressedAnalysisLoading}
                >
                  {suppressedAnalysisLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Asking LLM...
                    </>
                  ) : (
                    <>
                      <Brain className="w-3.5 h-3.5 mr-1.5" />
                      Ask LLM: Is this suppression valid?
                    </>
                  )}
                </Button>
              </div>

              {suppressedAnalysis && (
                <div className="text-sm whitespace-pre-wrap font-light leading-relaxed border-l-2 border-muted pl-4 py-2 bg-muted/50 rounded">
                  {typeof suppressedAnalysis.analysis === 'string'
                    ? suppressedAnalysis.analysis
                    : JSON.stringify(suppressedAnalysis.analysis, null, 2)}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Suppress / Apply LLM Response Dialog */}
      <Dialog open={bulkSuppressOpen} onOpenChange={setBulkSuppressOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Apply LLM Response — Bulk Suppress &amp; Refine
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
              <p>Paste the structured JSON response from an LLM that reviewed your findings.</p>
              <p className="mt-1">The prompt from <strong>Copy for LLM</strong> asks the LLM to respond with a JSON array of <code>suppress</code>, <code>fix</code>, or <code>refine_rule</code> actions. Paste that JSON here.</p>
            </div>

            {!bulkSuppressResult && (
              <>
                <Textarea
                  value={bulkSuppressText}
                  onChange={(e) => setBulkSuppressText(e.target.value)}
                  placeholder={'Paste LLM JSON response here...\n\nExample:\n[\n  {"index": 1, "action": "suppress", "reason": "SVG path data, not a credit card", "suppress_scope": "file", "suppress_file": "frontend/src/components/ThresholdConfiguratorModal.tsx"},\n  {"index": 2, "action": "refine_rule", "rule_id": "credit-card-number", "suggested_pattern": "\\\\b(?:\\\\d{4}[ -]?){3}\\\\d{4}\\\\b"}\n]'}
                  className="min-h-[200px] text-xs font-code"
                  disabled={bulkSuppressApplying}
                />
                <Button
                  onClick={handleBulkSuppress}
                  disabled={bulkSuppressApplying || !bulkSuppressText.trim()}
                  className="w-full"
                >
                  {bulkSuppressApplying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <Wrench className="w-4 h-4 mr-2" />
                      Parse &amp; Apply
                    </>
                  )}
                </Button>
              </>
            )}

            {bulkSuppressResult && (
              <>
                <div className="text-sm border rounded p-3 space-y-2">
                  <p className="font-medium">{bulkSuppressResult.message}</p>
                  {bulkSuppressResult.allowlist_added > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <ShieldOff className="w-3 h-3 inline mr-1" />
                      {bulkSuppressResult.allowlist_added} allowlist entries added
                    </p>
                  )}
                  {bulkSuppressResult.rules_refined > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <Filter className="w-3 h-3 inline mr-1" />
                      {bulkSuppressResult.rules_refined} rules refined
                    </p>
                  )}
                  {bulkSuppressResult.fixes_suggested > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <Brain className="w-3 h-3 inline mr-1" />
                      {bulkSuppressResult.fixes_suggested} fix suggestions (noted but not auto-applied)
                    </p>
                  )}
                  {bulkSuppressResult.errors?.length > 0 && (
                    <div className="text-xs text-red-400 mt-2 space-y-1">
                      {bulkSuppressResult.errors.map((err: string, i: number) => (
                        <div key={i}>{err}</div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBulkSuppressResult(null);
                      setBulkSuppressText("");
                    }}
                  >
                    Apply Another
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setBulkSuppressOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AllowlistPopover({
  finding,
  taskId,
  onAllowlisted,
}: {
  finding: Finding;
  taskId: string;
  onAllowlisted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"match" | "file-rule" | "file" | "custom">("match");
  const [customPattern, setCustomPattern] = useState("");
  const [reason, setReason] = useState("Allowlisted from scan results");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      let entry: Record<string, unknown> = { reason };
      switch (scope) {
        case "match":
          entry.match = finding.matched_text;
          entry.rules = [finding.rule_id];
          break;
        case "file-rule":
          entry.file = finding.file;
          entry.rules = [finding.rule_id];
          break;
        case "file":
          entry.file = finding.file;
          break;
        case "custom":
          entry.pattern = customPattern;
          break;
      }
      await addToAllowlist(taskId, [entry as any]);
      toast({ title: "Added to allowlist", description: `Finding allowlisted (${scope})` });
      onAllowlisted();
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to add to allowlist", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
          <ShieldOff className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-xs font-semibold text-foreground">Add to Allowlist</p>
        <div className="space-y-1.5">
          {[
            { value: "match" as const, label: "This exact match" },
            { value: "file-rule" as const, label: "This rule in this file" },
            { value: "file" as const, label: "All rules in this file" },
            { value: "custom" as const, label: "Custom pattern" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`scope-${finding.id}`}
                checked={scope === opt.value}
                onChange={() => setScope(opt.value)}
                className="accent-cyan-500"
              />
              <span className="text-xs text-foreground">{opt.label}</span>
            </label>
          ))}
        </div>
        {scope === "custom" && (
          <Input
            value={customPattern}
            onChange={(e) => setCustomPattern(e.target.value)}
            placeholder="Regex pattern"
            className="h-7 text-xs font-code bg-background border-border"
          />
        )}
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          className="h-7 text-xs bg-background border-border"
        />
        <Button
          size="sm"
          className="w-full h-7 text-xs"
          disabled={submitting || (scope === "custom" && !customPattern)}
          onClick={handleAdd}
        >
          {submitting ? "Adding…" : "Add to Allowlist"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
