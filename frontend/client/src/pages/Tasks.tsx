import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { TaskStateBadge, ScanTypeBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { fetchTasks, deleteTask, toggleTask, runTask, copyTask } from "@/lib/api";
import type { Task } from "@/lib/types";
import {
  Plus,
  Search,
  MoreHorizontal,
  Play,
  Pencil,
  Copy,
  Trash2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Tasks() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tasks = [], isLoading, error } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: fetchTasks,
    refetchInterval: 5000,  // Poll every 5s for live state/findings updates during runs
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Task deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleTask(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (err: Error) => {
      toast({ title: "Toggle failed", description: err.message, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runTask(id),
    onSuccess: () => {
      toast({ title: "Task run triggered" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (err: Error) => {
      toast({ title: "Run failed", description: err.message, variant: "destructive" });
    },
  });

  const copyMutation = useMutation({
    mutationFn: (id: string) => copyTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task copied as template" });
    },
    onError: (err: Error) => {
      toast({ title: "Copy failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredTasks = tasks.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.connection.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Failed to load tasks: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-card border-card-border text-sm"
            data-testid="input-search-tasks"
          />
        </div>
        <Link href="/tasks/new">
          <Button size="sm" className="h-9 gap-1.5" data-testid="button-create-task">
            <Plus className="w-4 h-4" />
            New Task
          </Button>
        </Link>
      </div>

      {/* Table */}
      <Card className="bg-card border-card-border overflow-hidden">
        <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Name</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Connection</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Type</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">State</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Last Run</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">Findings</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Schedule</TableHead>
              <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-center">Active</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  {searchQuery ? "No tasks match your search." : "No tasks configured yet."}
                </TableCell>
              </TableRow>
            ) : (
              filteredTasks.map((task) => (
                <TableRow key={task.id} className="border-border" data-testid={`row-task-${task.id}`}>
                  <TableCell>
                    <Link href={`/tasks/${task.id}/results`}>
                      <span className="text-sm font-medium text-foreground hover:text-primary cursor-pointer transition-colors">
                        {task.name}
                      </span>
                    </Link>
                    <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[200px] truncate">{task.description}</p>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-code text-muted-foreground">{task.connection}</span>
                  </TableCell>
                  <TableCell>
                    <ScanTypeBadge type={task.scan.type} />
                  </TableCell>
                  <TableCell>
                    <TaskStateBadge state={task.state} />
                  </TableCell>
                  <TableCell>
                    {task.last_run ? (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(task.last_run), { addSuffix: true })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {(task.findings_count ?? 0) > 0 ? (
                      <span className="text-sm font-medium text-cyan-400">{task.findings_count}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground/50">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span className="font-code">{task.schedule.cron}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={task.active}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: task.id, active: checked })}
                      className="data-[state=checked]:bg-cyan-500"
                      data-testid={`switch-active-${task.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                        onClick={() => runMutation.mutate(task.id)}
                        title="Run Now"
                        data-testid={`button-run-${task.id}`}
                      >
                        <Play className="w-3.5 h-3.5" fill="currentColor" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${task.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem className="text-xs gap-2" onClick={() => navigate(`/tasks/${task.id}/edit`)}>
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-xs gap-2" onClick={() => copyMutation.mutate(task.id)}>
                            <Copy className="w-3.5 h-3.5" /> Copy as Template
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-xs gap-2 text-red-400 focus:text-red-400"
                            onClick={() => setDeleteTaskId(task.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTaskId} onOpenChange={() => setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
              All run history and findings for this task will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTaskId) deleteMutation.mutate(deleteTaskId);
                setDeleteTaskId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
