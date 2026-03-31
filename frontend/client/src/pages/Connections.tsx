import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import { fetchConnections, createConnection, deleteConnection, testConnection } from "@/lib/api";
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
  HelpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusConfig: Record<string, { icon: typeof CheckCircle2; label: string; className: string }> = {
  connected: { icon: CheckCircle2, label: "Connected", className: "text-emerald-400" },
  error: { icon: XCircle, label: "Error", className: "text-red-400" },
  rate_limited: { icon: AlertTriangle, label: "Rate Limited", className: "text-amber-400" },
  untested: { icon: HelpCircle, label: "Untested", className: "text-muted-foreground" },
};

export default function Connections() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteConnectionId, setDeleteConnectionId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "connected" | "error">>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Form fields for add dialog
  const [formName, setFormName] = useState("");
  const [formOwner, setFormOwner] = useState("");
  const [formRepo, setFormRepo] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formBranch, setFormBranch] = useState("main");

  const { data: connections = [], isLoading, error } = useQuery<Connection[]>({
    queryKey: ["/api/connections"],
    queryFn: fetchConnections,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createConnection>[0]) => createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      setShowAddDialog(false);
      setFormName(""); setFormOwner(""); setFormRepo(""); setFormToken(""); setFormBranch("main");
      toast({ title: "Connection created" });
    },
    onError: (err: Error) => {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      toast({ title: "Connection deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: result.success ? "connected" : "error" }));
      toast({ title: result.success ? "Connection successful" : "Connection failed", description: result.message });
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [id]: "error" }));
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveConnection = () => {
    const id = formName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    createMutation.mutate({
      id: id || `conn-${Date.now()}`,
      name: formName,
      owner: formOwner,
      repo: formRepo,
      token: formToken,
      default_branch: formBranch,
    });
  };

  const getConnectionStatus = (conn: Connection) => {
    if (testResults[conn.id]) return testResults[conn.id];
    if (conn.status) return conn.status;
    return "untested";
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[900px]">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-9 w-36" />
        </div>
        {[1,2,3].map(i => <Skeleton key={i} className="h-[120px] rounded-lg" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Failed to load connections: {(error as Error).message}</p>
      </div>
    );
  }

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
        {connections.length === 0 ? (
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
          connections.map((conn) => {
            const connStatus = getConnectionStatus(conn);
            const status = statusConfig[connStatus] || statusConfig.untested;
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
              <Input className="mt-1 h-9 text-sm" placeholder="My Project" value={formName} onChange={(e) => setFormName(e.target.value)} data-testid="input-connection-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Owner</Label>
                <Input className="mt-1 h-9 text-sm font-code" placeholder="username" value={formOwner} onChange={(e) => setFormOwner(e.target.value)} data-testid="input-owner" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Repository</Label>
                <Input className="mt-1 h-9 text-sm font-code" placeholder="repo-name" value={formRepo} onChange={(e) => setFormRepo(e.target.value)} data-testid="input-repo" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">GitHub Token</Label>
              <Input type="password" className="mt-1 h-9 text-sm font-code" placeholder="ghp_..." value={formToken} onChange={(e) => setFormToken(e.target.value)} data-testid="input-token" />
              <p className="text-[10px] text-muted-foreground mt-1">Requires <code className="font-code">repo</code> scope for private repos</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Default Branch</Label>
              <Input className="mt-1 h-9 text-sm font-code" placeholder="main" value={formBranch} onChange={(e) => setFormBranch(e.target.value)} data-testid="input-branch" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveConnection} disabled={createMutation.isPending} data-testid="button-save-connection">Save Connection</Button>
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
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConnectionId) deleteMutation.mutate(deleteConnectionId);
                setDeleteConnectionId(null);
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
