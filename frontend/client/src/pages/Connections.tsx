import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { mockConnections } from "@/lib/mock-data";
import type { Connection } from "@/lib/types";
import {
  Plus,
  Plug,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Pencil,
  Trash2,
  GitBranch,
  Clock,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusConfig: Record<string, { icon: typeof CheckCircle2; label: string; className: string }> = {
  connected: { icon: CheckCircle2, label: "Connected", className: "text-emerald-400" },
  error: { icon: XCircle, label: "Error", className: "text-red-400" },
  rate_limited: { icon: AlertTriangle, label: "Rate Limited", className: "text-amber-400" },
};

export default function Connections() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteConnectionId, setDeleteConnectionId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => setTestingId(null), 2000);
  };

  return (
    <div className="space-y-4 max-w-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">GitHub repository connections for scanning</p>
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setShowAddDialog(true)} data-testid="button-add-connection">
          <Plus className="w-4 h-4" />
          Add Connection
        </Button>
      </div>

      {/* Connection Cards */}
      <div className="grid grid-cols-1 gap-3">
        {mockConnections.length === 0 ? (
          <Card className="bg-card border-card-border">
            <CardContent className="flex flex-col items-center py-12">
              <Plug className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No connections configured.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAddDialog(true)}>
                Add your first connection
              </Button>
            </CardContent>
          </Card>
        ) : (
          mockConnections.map((conn) => {
            const status = statusConfig[conn.status];
            const StatusIcon = status.icon;
            return (
              <Card key={conn.id} className="bg-card border-card-border" data-testid={`card-connection-${conn.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{conn.name}</h3>
                        <div className={`flex items-center gap-1 ${status.className}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          <span className="text-xs font-medium">{status.label}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="font-code">{conn.owner}/{conn.repo}</span>
                        <span className="flex items-center gap-1">
                          <GitBranch className="w-3 h-3" />
                          {conn.default_branch}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                        {conn.rate_limit_remaining !== undefined && (
                          <span>
                            Rate limit: <span className={conn.rate_limit_remaining < 100 ? "text-amber-400 font-medium" : "text-foreground font-medium"}>{conn.rate_limit_remaining.toLocaleString()}</span> / 5,000 remaining
                          </span>
                        )}
                        {conn.rate_limit_reset && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Resets {formatDistanceToNow(new Date(conn.rate_limit_reset), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1.5"
                        onClick={() => handleTest(conn.id)}
                        disabled={testingId === conn.id}
                        data-testid={`button-test-${conn.id}`}
                      >
                        {testingId === conn.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Test
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" data-testid={`button-edit-${conn.id}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-400"
                        onClick={() => setDeleteConnectionId(conn.id)}
                        data-testid={`button-delete-${conn.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Add Connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Connection Name</Label>
              <Input className="mt-1 h-9 text-sm" placeholder="My Project" data-testid="input-connection-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Owner</Label>
                <Input className="mt-1 h-9 text-sm font-code" placeholder="username" data-testid="input-owner" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Repository</Label>
                <Input className="mt-1 h-9 text-sm font-code" placeholder="repo-name" data-testid="input-repo" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">GitHub Token</Label>
              <Input type="password" className="mt-1 h-9 text-sm font-code" placeholder="ghp_..." data-testid="input-token" />
              <p className="text-[10px] text-muted-foreground mt-1">Requires <code className="font-code">repo</code> scope for private repos</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Default Branch</Label>
              <Input className="mt-1 h-9 text-sm font-code" placeholder="main" defaultValue="main" data-testid="input-branch" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button data-testid="button-save-connection">Save Connection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConnectionId} onOpenChange={() => setDeleteConnectionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this connection? Tasks using this connection will need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => setDeleteConnectionId(null)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
