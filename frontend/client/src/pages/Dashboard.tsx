import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStateBadge, ScanTypeBadge, RunStatusBadge } from "@/components/StatusBadge";
import { mockDashboard } from "@/lib/mock-data";
import {
  ListTodo,
  Zap,
  Search,
  Bell,
  AlertTriangle,
  Clock,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

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
  const data = mockDashboard;

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
          <Link href="/tasks">
            <Button variant="ghost" size="sm" className="ml-auto text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 text-xs">
              View Tasks <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
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
                    {task.last_run && (
                      <span>Last: {formatDistanceToNow(new Date(task.last_run), { addSuffix: true })}</span>
                    )}
                    {task.next_run && (
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
                          {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                          {run.duration_seconds && ` · ${run.duration_seconds}s`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {run.findings_count > 0 && (
                          <span className="text-xs text-cyan-400 font-medium">{run.findings_count}</span>
                        )}
                        <RunStatusBadge status={run.status} />
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
