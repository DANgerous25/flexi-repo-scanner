import { useState } from "react";
import { useRoute, Link, useParams } from "wouter";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SeverityBadge, RunStatusBadge, ScanTypeBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { fetchTask, fetchTaskResults, fetchRunFindings, addToAllowlist, fetchFileContent, stopRun, analyzeFinding } from "@/lib/api";
import CodeViewer from "@/components/CodeViewer";
import type { Task, TaskRun, Finding } from "@/lib/types";
import {
  Download,
  FileJson,
  FileSpreadsheet,
  ArrowLeft,
  Clock,
  FileSearch,
  ChevronRight,
  AlertTriangle,
  ClipboardCopy,
  Check,
  ShieldOff,
  ShieldCheck,
  StopCircle,
  Brain,
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
  const lines: string[] = [];

  lines.push("# Scan Findings — Review & Fix Suggestions Needed");
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push("Below are automated scan findings from a repository code scanner. For each finding:");
  lines.push("");
  lines.push("1. **Evaluate** whether it is a true positive or a false positive (explain your reasoning)");
  lines.push("2. **Classify** the risk level: `critical` / `high` / `medium` / `low` / `false-positive`");
  lines.push("3. **Suggest a fix** with the exact code change needed (show before/after), or explain why no fix is needed");
  lines.push("4. **Do NOT apply any changes** — present your analysis and wait for approval before proceeding");
  lines.push("");
  lines.push("## Context");
  lines.push("");
  lines.push(`- **Task:** ${task.name}`);
  lines.push(`- **Repository:** ${task.connection}`);
  lines.push(`- **Scan type:** ${task.scan?.type ?? "pattern"}`);
  lines.push(`- **Scan mode:** ${run.scan_mode ?? "full"}`);
  lines.push(`- **Run date:** ${run.started_at ?? "unknown"}`);
  lines.push(`- **Total findings:** ${findings.length}`);
  lines.push("");

  // Group by category
  const byCategory: Record<string, Finding[]> = {};
  findings.forEach((f) => {
    const cat = f.category || "Uncategorised";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(f);
  });

  lines.push("## Findings");
  lines.push("");

  let idx = 1;
  for (const [category, items] of Object.entries(byCategory).sort()) {
    lines.push(`### ${category} (${items.length})`);
    lines.push("");

    for (const f of items) {
      lines.push(`#### Finding ${idx}`);
      lines.push("");
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| **File** | \`${f.file}\` |`);
      lines.push(`| **Line** | ${f.line ?? "—"} |`);
      lines.push(`| **Severity** | ${f.severity} |`);
      lines.push(`| **Rule** | ${f.rule_name || f.rule_id || "—"} |`);
      if (f.matched_text) {
        lines.push(`| **Matched text** | \`${f.matched_text}\` |`);
      }
      if (f.context) {
        lines.push("");
        lines.push("<details><summary>Context</summary>");
        lines.push("");
        lines.push("```");
        lines.push(f.context);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
      }
      lines.push("");
      idx++;
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Expected Output Format");
  lines.push("");
  lines.push("For each finding, respond with:");
  lines.push("");
  lines.push("```");
  lines.push("### Finding N — [true-positive | false-positive]");
  lines.push("**Risk:** critical / high / medium / low / false-positive");
  lines.push("**Reasoning:** Why this is or isn't an issue.");
  lines.push("**Suggested fix:**");
  lines.push("- File: `path/to/file`");
  lines.push("- Before: `matched text or line`");
  lines.push("- After: `replacement text or line`");
  lines.push("```");
  lines.push("");
  lines.push("After listing all evaluations, provide a **Summary** with:");
  lines.push("- Count of true positives vs false positives");
  lines.push("- Prioritised list of fixes (critical first)");
  lines.push("- Any patterns suggesting rule adjustments");
  lines.push("");
  lines.push("**Wait for my approval before applying any changes.**");

  return lines.join("\n");
}

export default function TaskResults() {
  const params = useParams();
  const taskId = params?.id ?? null;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"none" | "category" | "severity">("none");
  const [copied, setCopied] = useState(false);
  const [allowlistedIds, setAllowlistedIds] = useState<Set<string>>(new Set());
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

  const groupedFindings = (() => {
    if (groupBy === "none") return { "All Findings": findings };
    const groups: Record<string, typeof findings> = {};
    findings.forEach((f) => {
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
        <Link href="/tasks">
          <Button variant="link" className="mt-2 text-xs">Back to Tasks</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/tasks">
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
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
          {selectedRun && findings.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className={`h-8 text-xs gap-1.5 transition-colors ${
                copied ? "border-emerald-500/50 text-emerald-400" : ""
              }`}
              data-testid="button-copy-llm"
              onClick={() => {
                const md = formatFindingsForLLM(task, selectedRun, findings);
                navigator.clipboard.writeText(md).then(() => {
                  setCopied(true);
                  toast({ title: "Copied to clipboard", description: `${findings.length} findings formatted for LLM review` });
                  setTimeout(() => setCopied(false), 2500);
                });
              }}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <ClipboardCopy className="w-3.5 h-3.5" />
              )}
              {copied ? "Copied" : "Copy for LLM"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            data-testid="button-export-json"
            disabled={!selectedRun}
            onClick={() => {
              if (selectedRun) {
                const a = document.createElement("a");
                a.href = `/api/results/${encodeURIComponent(selectedRun.id)}/export/json`;
                a.download = `findings-${selectedRun.id}.json`;
                a.click();
              }
            }}
          >
            <FileJson className="w-3.5 h-3.5" /> JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            data-testid="button-export-csv"
            disabled={!selectedRun}
            onClick={() => {
              if (selectedRun) {
                const a = document.createElement("a");
                a.href = `/api/results/${encodeURIComponent(selectedRun.id)}/export/csv`;
                a.download = `findings-${selectedRun.id}.csv`;
                a.click();
              }
            }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Run History */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Run History</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Timestamp</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Duration</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">Findings</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Mode</TableHead>
              <TableHead className="w-8" />
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
                    <ChevronRight className={`w-4 h-4 transition-colors ${selectedRun?.id === run.id ? "text-primary" : "text-muted-foreground/30"}`} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Findings Detail */}
      {selectedRun && (
        <Card className="bg-card border-card-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm font-semibold">
                  Findings — {safeFormat(selectedRun.started_at, "MMM d, HH:mm")}
                </CardTitle>
                <Badge variant="outline" className="text-xs">{findings.length} findings</Badge>
              </div>
              <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
                <SelectTrigger className="w-40 h-8 text-xs bg-background border-border" data-testid="select-group-by">
                  <SelectValue placeholder="Group by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No grouping</SelectItem>
                  <SelectItem value="category">By Category</SelectItem>
                  <SelectItem value="severity">By Severity</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          {findings.length === 0 ? (
            <CardContent>
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <FileSearch className="w-6 h-6 mb-2" />
                <p className="text-sm">No findings in this run.</p>
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
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((finding) => {
                      const isAllowlisted = allowlistedIds.has(finding.id);
                      return (
                      <TableRow
                        key={finding.id}
                        className={`border-border ${isAllowlisted ? "opacity-50" : ""}`}
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
                          {isAllowlisted && (
                            <Badge variant="outline" className="ml-2 text-[9px] border-emerald-500/30 text-emerald-400">allowlisted</Badge>
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
                        <TableCell className="flex items-center gap-1">
                          <AllowlistPopover
                            finding={finding}
                            taskId={taskId!}
                            onAllowlisted={() => {
                              setAllowlistedIds((prev) => new Set([...prev, finding.id]));
                              queryClient.invalidateQueries({ queryKey: [`/api/tasks/${taskId}`] });
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleAskLLM(finding)}
                            title="Ask LLM to analyze this finding"
                          >
                            <Brain className="h-3.5 w-3.5" />
                          </Button>
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
