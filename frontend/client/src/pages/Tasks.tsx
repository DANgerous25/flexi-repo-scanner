import { useState } from "react";
import { Link, useLocation } from "wouter";
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
import { mockTasks } from "@/lib/mock-data";
import {
  Plus,
  Search,
  MoreHorizontal,
  Play,
  Pencil,
  Copy,
  Trash2,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Tasks() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  const filteredTasks = mockTasks.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.connection.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <Card className="bg-card border-card-border">
        <Table>
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
                    {task.findings_count > 0 ? (
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
                      onCheckedChange={() => {}}
                      className="data-[state=checked]:bg-cyan-500"
                      data-testid={`switch-active-${task.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${task.id}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem className="text-xs gap-2">
                          <Play className="w-3.5 h-3.5" /> Run Now
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2" onClick={() => navigate(`/tasks/${task.id}/edit`)}>
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2">
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
              onClick={() => setDeleteTaskId(null)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
