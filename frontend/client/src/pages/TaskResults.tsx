import { useState } from "react";
import { useRoute, Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { SeverityBadge, RunStatusBadge, ScanTypeBadge } from "@/components/StatusBadge";
import { fetchTask, fetchTaskResults, fetchRunFindings } from "@/lib/api";
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

export default function TaskResults() {
  const params = useParams();
  const taskId = params?.id ?? null;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"none" | "category" | "severity">("none");

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
            <h2 className="text-sm font-semibold text-foreground">{task.name}</h2>
            <p className="text-xs text-muted-foreground">{task.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-export-json">
            <FileJson className="w-3.5 h-3.5" /> JSON
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-export-csv">
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
                    <RunStatusBadge status={run.status} />
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((finding) => (
                      <TableRow key={finding.id} className="border-border" data-testid={`row-finding-${finding.id}`}>
                        <TableCell>
                          <span className="text-xs font-code text-foreground">{finding.file}</span>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}
