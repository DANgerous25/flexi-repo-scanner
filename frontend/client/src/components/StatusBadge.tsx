import { Badge } from "@/components/ui/badge";
import type { TaskState, Severity } from "@/lib/types";
import {
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  AlertTriangle,
  MinusCircle,
} from "lucide-react";

const stateConfig: Record<TaskState, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  completed: { label: "Completed", className: "status-completed", icon: CheckCircle2 },
  running: { label: "Running", className: "status-running", icon: Loader2 },
  scheduled: { label: "Scheduled", className: "status-scheduled", icon: Clock },
  failed: { label: "Failed", className: "status-failed", icon: XCircle },
  inactive: { label: "Inactive", className: "status-inactive", icon: MinusCircle },
  partial: { label: "Partial", className: "status-partial", icon: AlertTriangle },
};

export function TaskStateBadge({ state }: { state: TaskState | string }) {
  const config = stateConfig[state as TaskState] || {
    label: String(state || "Unknown"),
    className: "status-inactive",
    icon: MinusCircle,
  };
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.className} gap-1 text-xs font-medium border`} data-testid={`badge-state-${state}`}>
      <Icon className={`w-3 h-3 ${state === "running" ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}

const severityConfig: Record<Severity, { className: string }> = {
  critical: { className: "bg-red-500/15 text-red-400 border-red-500/20" },
  high: { className: "bg-orange-500/15 text-orange-400 border-orange-500/20" },
  medium: { className: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  low: { className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  info: { className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20" },
};

export function SeverityBadge({ severity }: { severity: Severity | string | undefined }) {
  const config = severityConfig[severity as Severity] || severityConfig.info;
  return (
    <Badge variant="outline" className={`${config.className} text-xs font-medium border capitalize`} data-testid={`badge-severity-${severity}`}>
      {severity || "unknown"}
    </Badge>
  );
}

export function ScanTypeBadge({ type }: { type: string }) {
  const config: Record<string, string> = {
    pattern: "bg-violet-500/15 text-violet-400 border-violet-500/20",
    "llm-review": "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    "doc-coverage": "bg-teal-500/15 text-teal-400 border-teal-500/20",
  };
  const labels: Record<string, string> = {
    pattern: "Pattern",
    "llm-review": "LLM Review",
    "doc-coverage": "Doc Coverage",
  };
  return (
    <Badge variant="outline" className={`${config[type] || ""} text-xs font-medium border`}>
      {labels[type] || type}
    </Badge>
  );
}

export function RunStatusBadge({ status, reason }: { status: string; reason?: string }) {
  const config: Record<string, { label: string; className: string }> = {
    completed: { label: "Completed", className: "status-completed" },
    running: { label: "Running", className: "status-running" },
    failed: { label: "Failed", className: "status-failed" },
    cancelled: { label: "Cancelled", className: "bg-orange-500/15 text-orange-400 border-orange-500/20" },
    partial: { label: "Partial", className: "status-partial" },
  };
  const c = config[status] || { label: status, className: "" };
  return (
    <Badge variant="outline" className={`${c.className} text-xs font-medium border`} title={reason}>
      {c.label}
    </Badge>
  );
}
