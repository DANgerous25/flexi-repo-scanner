import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStateBadge, ScanTypeBadge, RunStatusBadge } from "@/components/StatusBadge";
import {
  ListTodo,
  Zap,
  Search,
  Bell,
  AlertTriangle,
  Clock,
  ArrowRight,
  ChevronRight,
  StopCircle,
  X,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { stopRun, dismissFailedTaskAlert } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { DashboardStats } from "@/lib/types";

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof ListTodo;
  accent?: string;
}) {
  return (
    <Card className="bg-card border-card-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${accent || "text-foreground"}`} data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
              {value}
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [isDismissingAll, setIsDismissingAll] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStopRun = async (runId: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation from the Link wrapper
    e.stopPropagation();
    setStoppingRunId(runId);
    try {
      await stopRun(runId);
      toast({ title: "Run stopped", description: "The scan run has been stopped." });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    } catch (err: any) {
      toast({ title: "Failed to stop run", description: err.message, variant: "destructive" });
    } finally {
      setStoppingRunId(null);
    }
  };

  const handleDismissAll = async () => {
    setIsDismissingAll(true);
    try {
      await Promise.all((data?.failed_tasks ?? []).map(taskId => dismissFailedTaskAlert(taskId)));
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    } catch (err: any) {
      toast({ title: "Failed to dismiss alerts", description: err.message, variant: "destructive" });
    } finally {
      setIsDismissingAll(false);
    }
  };

  const { data, isLoading, error } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard"],
    select: (raw: any) => ({
      total_tasks: raw.stats?.total_tasks ?? 0,
      active_tasks: raw.stats?.active_tasks ?? 0,
      findings_today: raw.stats?.findings_today ?? 0,
      unread_notifications: raw.stats?.unread_notifications ?? 0,
      tasks: (raw.tasks ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        state: t.status ?? t.state ?? "inactive",
        scan_type: t.type ?? t.scan_type ?? "pattern",
        // last_run from backend is the full run object — extract the timestamp
        last_run: typeof t.last_run === "object" && t.last_run
          ? (t.last_run.started_at ?? t.last_run.completed_at)
          : t.last_run,
        next_run: t.next_run_at ?? t.next_run,
        findings_count: t.finding_count ?? t.findings_count ?? 0,
        connection: t.connection,
      })),
      recent_runs: (raw.recent_runs ?? []).map((r: any) => ({
        ...r,
        // DB has no task_name column — use task_id as fallback
        task_name: r.task_name ?? r.task_id ?? "Unknown",
        findings_count: r.finding_count ?? r.findings_count ?? 0,
        duration_seconds: r.duration_seconds ?? (
          r.started_at && r.completed_at
            ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)
            : undefined
        ),
      })),
      failed_tasks: raw.stats?.failed_tasks ?? raw.failed_tasks ?? [],
    }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-[80px] rounded-lg" />)}
        </div>
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Failed to load dashboard{error ? `: ${error.message}` : ""}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Alert banner for failed tasks */}
      {data.failed_tasks.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="alert-failed-tasks">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">
            <span className="font-medium">{data.failed_tasks.length} task{data.failed_tasks.length > 1 ? "s" : ""} failed.</span>{" "}
            Check {data.failed_tasks.map((t) => `"${data.tasks.find((task) => task.id === t)?.name || t}"`).join(", ")} for errors.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400/70 hover:text-red-300 hover:bg-red-500/10 h-6 px-2 text-xs"
              onClick={handleDismissAll}
              disabled={isDismissingAll}
            >
              {isDismissingAll ? "..." : "Dismiss"}
            </Button>
            <Link href="/tasks">
              <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 text-xs">
                View Tasks <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Tasks" value={data.total_tasks} icon={ListTodo} />
        <StatCard label="Active" value={data.active_tasks} icon={Zap} accent="text-emerald-400" />
        <StatCard label="Findings Today" value={data.findings_today} icon={Search} accent="text-cyan-400" />
        <StatCard label="Unread Alerts" value={data.unread_notifications} icon={Bell} accent={data.unread_notifications > 0 ? "text-amber-400" : undefined} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Task Status Grid */}
        <div className="col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Task Status</h2>
            <Link href="/tasks">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground h-7">
                View all <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {data.tasks.map((task) => (
              <Card key={task.id} className="bg-card border-card-border hover:border-primary/30 transition-colors" data-testid={`card-task-${task.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/tasks/${task.id}/results`}>
                        <span className="text-sm font-medium text-foreground hover:text-primary cursor-pointer transition-colors">
                          {task.name}
                        </span>
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5 font-code truncate">{task.connection}</p>
                    </div>
                    <TaskStateBadge state={task.state} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <ScanTypeBadge type={task.scan_type} />
                      {task.findings_count > 0 && (
                        <span className="text-cyan-400 font-medium">{task.findings_count} findings</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                    {task.last_run && !isNaN(new Date(task.last_run).getTime()) && (
                      <span>Last: {formatDistanceToNow(new Date(task.last_run), { addSuffix: true })}</span>
                    )}
                    {task.next_run && !isNaN(new Date(task.next_run).getTime()) && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Next: {formatDistanceToNow(new Date(task.next_run), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
          <div className="space-y-2">
            {data.recent_runs.map((run) => (
              <Link key={run.id} href={`/tasks/${run.task_id}/results`}>
                <Card className="bg-card border-card-border hover:border-primary/30 transition-colors cursor-pointer" data-testid={`run-${run.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground font-medium truncate">{run.task_name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {run.started_at && !isNaN(new Date(run.started_at).getTime())
                            ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true })
                            : "Unknown"}
                          {run.duration_seconds != null && ` · ${run.duration_seconds}s`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {run.findings_count > 0 && (
                          <span className="text-xs text-cyan-400 font-medium">{run.findings_count}</span>
                        )}
                        <RunStatusBadge status={run.status} reason={run.error} />
                        {run.status === "running" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            disabled={stoppingRunId === run.id}
                            onClick={(e) => handleStopRun(run.id, e)}
                            title="Stop this run"
                          >
                            <StopCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {run.error && (
                      <p className="text-[11px] text-red-400 mt-1 truncate">{run.error}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
