import { useState, useMemo } from "react";
import { useRoute, useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fetchTask, createTask, updateTask, fetchConnections, fetchModels, generateRules } from "@/lib/api";
import type { Task, Connection, LLMModel, PatternRule, AllowlistEntry, TaskAction, Severity } from "@/lib/types";
import {
  Save,
  X,
  Plus,
  Trash2,
  Code,
  FileText,
  Wand2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  AlertTriangle,
  ClipboardCopy,
  Check,
  Sparkles,
  Loader2,
} from "lucide-react";

export default function TaskEditor() {
  const params = useParams();
  const [location, navigate] = useLocation();
  const isNew = location === "/tasks/new";
  const taskId = params?.id ?? null;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: existingTask, isLoading: taskLoading } = useQuery<Task>({
    queryKey: [`/api/tasks/${taskId}`],
    queryFn: () => fetchTask(taskId!),
    enabled: !!taskId && !isNew,
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ["/api/connections"],
    queryFn: fetchConnections,
  });

  const { data: models = [] } = useQuery<LLMModel[]>({
    queryKey: ["/api/settings/models"],
    queryFn: fetchModels,
  });

  const [initialized, setInitialized] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connection, setConnection] = useState("");
  const [scanType, setScanType] = useState("pattern");
  const [scanMode, setScanMode] = useState("full");
  const [cron, setCron] = useState("0 8 * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [includeGlobs, setIncludeGlobs] = useState("**/*");
  const [excludeGlobs, setExcludeGlobs] = useState("node_modules/, dist/");
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [llmModel, setLlmModel] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [focusTags, setFocusTags] = useState("");
  const [maxFiles, setMaxFiles] = useState("50");
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [actions, setActions] = useState<TaskAction[]>([]);
  const [builderPrompt, setBuilderPrompt] = useState("");
  const [refinementPrompt, setRefinementPrompt] = useState("");
  const [refinementCopied, setRefinementCopied] = useState(false);

  // LLM generation state
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generatePreview, setGeneratePreview] = useState<{
    suggestions: string;
    parsed: Record<string, unknown>;
    model: string;
    tokens: { input: number; output: number };
  } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [refinePreview, setRefinePreview] = useState<{
    suggestions: string;
    parsed: Record<string, unknown>;
    model: string;
    tokens: { input: number; output: number };
  } | null>(null);

  // Initialize form from fetched task
  if (existingTask && !initialized) {
    setName(existingTask.name || "");
    setDescription(existingTask.description || "");
    setConnection(existingTask.connection || "");
    setScanType(existingTask.scan.type || "pattern");
    setScanMode(existingTask.scan.mode || "full");
    setCron(existingTask.schedule.cron || "0 8 * * *");
    setTimezone(existingTask.schedule.timezone || "UTC");
    setIncludeGlobs(existingTask.scan.paths.include.join(", ") || "**/*");
    setExcludeGlobs(existingTask.scan.paths.exclude.join(", ") || "node_modules/, dist/");
    setRules(existingTask.scan.rules || []);
    setLlmModel(existingTask.scan.llm?.model || "");
    setPromptTemplate(existingTask.scan.llm?.prompt_template || "");
    setFocusTags(existingTask.scan.llm?.focus?.join(", ") || "");
    setMaxFiles(existingTask.scan.llm?.max_files_per_run?.toString() || "50");
    setAllowlist(existingTask.scan.allowlist || []);
    setActions(existingTask.actions || []);
    setBuilderPrompt(existingTask.task_builder_prompt || "");
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) => {
      if (isNew) return createTask(config);
      return updateTask(taskId!, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: isNew ? "Task created" : "Task updated" });
      navigate("/tasks");
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = async () => {
    // For existing tasks, re-fetch to merge any externally-added allowlist entries
    let mergedAllowlist = allowlist;
    if (taskId && !isNew) {
      try {
        const freshTask = await fetchTask(taskId);
        const serverAllowlist = freshTask.scan?.allowlist || [];
        const localKeys = new Set(
          mergedAllowlist.map((e) => `${e.file || ""}|${e.pattern || ""}|${e.match || ""}`)
        );
        for (const entry of serverAllowlist) {
          const key = `${entry.file || ""}|${entry.pattern || ""}|${entry.match || ""}`;
          if (!localKeys.has(key)) {
            mergedAllowlist = [...mergedAllowlist, entry];
          }
        }
      } catch {
        // If re-fetch fails, proceed with local state — backend merge is the safety net
      }
    }

    const config: Record<string, unknown> = {
      name,
      description,
      connection,
      schedule: { cron, timezone },
      scan: {
        mode: scanMode,
        type: scanType,
        paths: {
          include: includeGlobs.split(",").map((g) => g.trim()).filter(Boolean),
          exclude: excludeGlobs.split(",").map((g) => g.trim()).filter(Boolean),
        },
        ...(scanType === "pattern" ? { rules } : {}),
        ...(scanType === "llm-review"
          ? {
              llm: {
                model: llmModel,
                prompt_template: promptTemplate || undefined,
                focus: focusTags ? focusTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
                max_files_per_run: maxFiles ? parseInt(maxFiles, 10) : undefined,
              },
            }
          : {}),
        allowlist: mergedAllowlist,
      },
      actions,
      task_builder_prompt: builderPrompt || undefined,
    };
    saveMutation.mutate(config);
  };

  const addRule = () => {
    setRules([...rules, { id: `rule-${Date.now()}`, name: "", pattern: "", severity: "medium" }]);
  };

  const updateRule = (index: number, field: keyof PatternRule, value: string | boolean) => {
    const updated = [...rules];
    (updated[index] as any)[field] = value;
    setRules(updated);
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const addAllowlistEntry = () => {
    setAllowlist([...allowlist, { reason: "" }]);
  };

  const removeAllowlistEntry = (index: number) => {
    setAllowlist(allowlist.filter((_, i) => i !== index));
  };

  const addAction = () => {
    setActions([...actions, { type: "in-app-notify", trigger: "findings" }]);
  };

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    setGenerateLoading(true);
    setGeneratePreview(null);
    try {
      const result = await generateRules("create", builderPrompt);
      setGeneratePreview(result);
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerateLoading(false);
    }
  };

  const applyGeneratedRules = () => {
    if (!generatePreview?.parsed) return;
    const parsed = generatePreview.parsed as { rules?: any[] };
    const newRules: PatternRule[] = (parsed.rules || []).map((r: any) => ({
      id: r.id || `rule-${Date.now()}`,
      name: r.name || "",
      pattern: r.pattern || "",
      severity: r.severity || "medium",
      case_sensitive: r.case_sensitive,
      context_requires: r.context_requires,
    }));
    if (newRules.length > 0) {
      setRules(newRules);
      toast({ title: "Rules applied", description: `${newRules.length} rule(s) set from LLM suggestions` });
    }
    setGeneratePreview(null);
  };

  const buildCurrentConfig = (): Record<string, unknown> => ({
    name,
    description,
    connection,
    schedule: { cron, timezone },
    scan: {
      mode: scanMode,
      type: scanType,
      paths: {
        include: includeGlobs.split(",").map((g) => g.trim()).filter(Boolean),
        exclude: excludeGlobs.split(",").map((g) => g.trim()).filter(Boolean),
      },
      ...(scanType === "pattern" ? { rules } : {}),
      allowlist: allowlist.length > 0 ? allowlist : undefined,
    },
    actions,
  });

  const handleRefine = async () => {
    setRefineLoading(true);
    setRefinePreview(null);
    try {
      const result = await generateRules("refine", refinementPrompt, buildCurrentConfig());
      setRefinePreview(result);
    } catch (err: any) {
      toast({ title: "Refinement failed", description: err.message, variant: "destructive" });
    } finally {
      setRefineLoading(false);
    }
  };

  const applyRefineSuggestions = () => {
    if (!refinePreview?.parsed) return;
    const p = refinePreview.parsed as {
      rules_to_add?: any[];
      rules_to_modify?: any[];
      rules_to_remove?: any[];
      allowlist_to_add?: any[];
      paths_to_exclude?: any[];
    };
    let updated = [...rules];

    // Add new rules
    if (p.rules_to_add?.length) {
      for (const r of p.rules_to_add) {
        updated.push({
          id: r.id || `rule-${Date.now()}`,
          name: r.name || "",
          pattern: r.pattern || "",
          severity: r.severity || "medium",
          case_sensitive: r.case_sensitive,
          context_requires: r.context_requires,
        });
      }
    }

    // Modify existing rules
    if (p.rules_to_modify?.length) {
      for (const mod of p.rules_to_modify) {
        const idx = updated.findIndex((r) => r.id === mod.id);
        if (idx !== -1 && mod.changes) {
          updated[idx] = { ...updated[idx], ...mod.changes };
        }
      }
    }

    // Remove rules
    if (p.rules_to_remove?.length) {
      const idsToRemove = new Set(p.rules_to_remove.map((r: any) => (typeof r === "string" ? r : r.id)));
      updated = updated.filter((r) => !idsToRemove.has(r.id));
    }

    setRules(updated);

    // Append to allowlist
    if (p.allowlist_to_add?.length) {
      const newEntries: AllowlistEntry[] = p.allowlist_to_add.map((a: any) => ({
        file: a.file,
        match: a.match,
        pattern: a.pattern,
        rules: a.rules,
        reason: a.reason || "",
      }));
      setAllowlist([...allowlist, ...newEntries]);
    }

    // Append to exclude globs
    if (p.paths_to_exclude?.length) {
      const current = excludeGlobs.split(",").map((g) => g.trim()).filter(Boolean);
      const merged = [...current, ...p.paths_to_exclude];
      setExcludeGlobs(merged.join(", "));
    }

    toast({ title: "Refinements applied", description: "Suggestions merged into current config" });
    setRefinePreview(null);
  };

  // Generate YAML representation
  const yamlContent = `id: "${taskId || "new-task"}"
name: "${name}"
description: "${description}"
active: true
connection: "${connection}"
schedule:
  cron: "${cron}"
  timezone: "${timezone}"
scan:
  mode: "${scanMode}"
  type: "${scanType}"
  paths:
    include: [${includeGlobs.split(",").map((g) => `"${g.trim()}"`).join(", ")}]
    exclude: [${excludeGlobs.split(",").map((g) => `"${g.trim()}"`).join(", ")}]
${scanType === "pattern" ? `  rules:\n${rules.map((r) => `    - id: "${r.id}"\n      name: "${r.name}"\n      pattern: '${r.pattern}'\n      severity: "${r.severity}"${r.case_sensitive === false ? "\n      case_sensitive: false" : ""}${r.context_requires ? `\n      context_requires: '${r.context_requires}'` : ""}`).join("\n")}` : ""}
${scanType === "llm-review" ? `  llm:\n    model: "${llmModel}"\n    prompt_template: "${promptTemplate}"\n    focus: [${focusTags.split(",").map((t) => `"${t.trim()}"`).join(", ")}]\n    max_files_per_run: ${maxFiles}` : ""}
actions:
${actions.map((a) => `  - type: "${a.type}"\n    trigger: "${a.trigger}"${a.recipients ? `\n    recipients: [${a.recipients.map((r) => `"${r}"`).join(", ")}]` : ""}`).join("\n")}`;

  if (taskLoading && !isNew) {
    return (
      <div className="space-y-6 max-w-[900px]">
        <Skeleton className="h-[120px] rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  if (!isNew && taskId && !existingTask && !taskLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Task not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[900px]">
      {/* NLP builder */}
      <Card className="bg-card border-card-border">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Wand2 className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground font-medium">Describe what you want to scan for</Label>
              <Textarea
                placeholder='e.g. "Check if any file contains my phone number 555-0123 or references to Project Phoenix"'
                value={builderPrompt}
                onChange={(e) => setBuilderPrompt(e.target.value)}
                className="mt-1.5 h-16 text-sm bg-background border-border resize-none"
                data-testid="input-builder-prompt"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs gap-1.5"
                disabled={!builderPrompt || generateLoading}
                onClick={handleGenerate}
              >
                {generateLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {generateLoading ? "Generating…" : "Generate Rules"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate preview card */}
      {generatePreview && (
        <Card className="bg-card border-primary/30 border-dashed">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary">LLM Suggestions</span>
              <span className="text-[10px] text-muted-foreground">
                {generatePreview.model} · {generatePreview.tokens.input + generatePreview.tokens.output} tokens
              </span>
            </div>
            <pre className="text-xs font-mono bg-background rounded-lg p-3 overflow-auto max-h-[300px] border border-border whitespace-pre-wrap">
              {generatePreview.suggestions}
            </pre>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={applyGeneratedRules}>Apply Rules</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setGeneratePreview(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refine with Prompt */}
      {!isNew && (
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground font-medium">Refine existing rules</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-1.5">
                  Describe what to change. Copies current config + your prompt to clipboard for LLM review.
                </p>
                <Textarea
                  value={refinementPrompt}
                  onChange={(e) => setRefinementPrompt(e.target.value)}
                  placeholder='e.g. "Exclude numeric patterns in earnings files" or "Stop flagging version numbers as phone numbers"'
                  className="h-16 text-sm bg-background border-border resize-none"
                  data-testid="input-refinement-prompt"
                />
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    disabled={!refinementPrompt.trim() || refineLoading}
                    data-testid="button-generate-suggestions"
                    onClick={handleRefine}
                  >
                    {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {refineLoading ? "Getting suggestions…" : "Get Suggestions"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 text-xs gap-1.5 transition-colors ${refinementCopied ? "text-emerald-400" : ""}`}
                    disabled={!refinementPrompt.trim()}
                    onClick={() => {
                      const rulesYaml = rules.map((r) =>
                        `  - id: "${r.id}"\n    name: "${r.name}"\n    pattern: '${r.pattern}'\n    severity: "${r.severity}"`
                      ).join("\n");
                      const allowlistYaml = allowlist.length > 0
                        ? allowlist.map((a) => {
                            const parts = [];
                            if (a.file) parts.push(`file: "${a.file}"`);
                            if (a.match) parts.push(`match: "${a.match}"`);
                            if (a.pattern) parts.push(`pattern: "${a.pattern}"`);
                            if (a.rules?.length) parts.push(`rules: [${a.rules.map((r) => `"${r}"`).join(", ")}]`);
                            parts.push(`reason: "${a.reason}"`);
                            return `  - { ${parts.join(", ")} }`;
                          }).join("\n")
                        : "  (none)";

                      const md = [
                        "# Task Config Refinement Request",
                        "",
                        "## Current Task Config",
                        "",
                        "```yaml",
                        `name: "${name}"`,
                        `connection: "${connection}"`,
                        `scan:`,
                        `  type: "${scanType}"`,
                        `  mode: "${scanMode}"`,
                        `  paths:`,
                        `    include: [${includeGlobs.split(",").map((g) => `"${g.trim()}"`).join(", ")}]`,
                        `    exclude: [${excludeGlobs.split(",").map((g) => `"${g.trim()}"`).join(", ")}]`,
                        scanType === "pattern" ? `  rules:\n${rulesYaml}` : "",
                        `  allowlist:\n${allowlistYaml}`,
                        "```",
                        "",
                        "## Refinement Request",
                        "",
                        refinementPrompt.trim(),
                      ].filter(Boolean).join("\n");

                      navigator.clipboard.writeText(md).then(() => {
                        setRefinementCopied(true);
                        toast({ title: "Copied to clipboard", description: "Task config + refinement prompt copied" });
                        setTimeout(() => setRefinementCopied(false), 2500);
                      });
                    }}
                  >
                    {refinementCopied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                    {refinementCopied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refine preview card */}
      {refinePreview && (
        <Card className="bg-card border-primary/30 border-dashed">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary">LLM Suggestions</span>
              <span className="text-[10px] text-muted-foreground">
                {refinePreview.model} · {refinePreview.tokens.input + refinePreview.tokens.output} tokens
              </span>
            </div>
            <pre className="text-xs font-mono bg-background rounded-lg p-3 overflow-auto max-h-[300px] border border-border whitespace-pre-wrap">
              {refinePreview.suggestions}
            </pre>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={applyRefineSuggestions}>Apply Changes</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRefinePreview(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mode toggle */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant={showYaml ? "outline" : "secondary"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setShowYaml(false)}
        >
          <FileText className="w-3.5 h-3.5" /> Form
        </Button>
        <Button
          variant={showYaml ? "secondary" : "outline"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setShowYaml(true)}
        >
          <Code className="w-3.5 h-3.5" /> YAML
        </Button>
      </div>

      {showYaml ? (
        /* YAML Editor */
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <Textarea
              value={yamlContent}
              className="font-code text-xs h-[500px] bg-background border-border resize-none"
              data-testid="textarea-yaml"
            />
          </CardContent>
        </Card>
      ) : (
        /* Form Editor */
        <div className="space-y-4">
          {/* Identity Section */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-task-name" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Connection</Label>
                  <Select value={connection} onValueChange={setConnection}>
                    <SelectTrigger className="mt-1 h-9 text-sm bg-background border-border" data-testid="select-connection">
                      <SelectValue placeholder="Select connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {connections.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.owner}/{c.repo})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 h-16 text-sm bg-background border-border resize-none" data-testid="input-task-description" />
              </div>
            </CardContent>
          </Card>

          {/* Schedule Section */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Cron Expression</Label>
                  <Input value={cron} onChange={(e) => setCron(e.target.value)} className="mt-1 h-9 text-sm font-code bg-background border-border" placeholder="0 8 * * *" data-testid="input-cron" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Timezone</Label>
                  <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" placeholder="UTC" data-testid="input-timezone" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scan Config */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Scan Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Scan Type</Label>
                  <Select value={scanType} onValueChange={setScanType}>
                    <SelectTrigger className="mt-1 h-9 text-sm bg-background border-border" data-testid="select-scan-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pattern">Pattern (Regex)</SelectItem>
                      <SelectItem value="llm-review">LLM Review</SelectItem>
                      <SelectItem value="doc-coverage">Doc Coverage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Scan Mode</Label>
                  <Select value={scanMode} onValueChange={setScanMode}>
                    <SelectTrigger className="mt-1 h-9 text-sm bg-background border-border" data-testid="select-scan-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full Scan</SelectItem>
                      <SelectItem value="diff">Diff (Changes Only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Include Paths (comma-separated globs)</Label>
                  <Input value={includeGlobs} onChange={(e) => setIncludeGlobs(e.target.value)} className="mt-1 h-9 text-xs font-code bg-background border-border" data-testid="input-include-paths" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Exclude Paths</Label>
                  <Input value={excludeGlobs} onChange={(e) => setExcludeGlobs(e.target.value)} className="mt-1 h-9 text-xs font-code bg-background border-border" data-testid="input-exclude-paths" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pattern Rules (only for pattern type) */}
          {scanType === "pattern" && (
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Pattern Rules</CardTitle>
                  <Button variant="outline" size="sm" onClick={addRule} className="h-7 text-xs gap-1" data-testid="button-add-rule">
                    <Plus className="w-3 h-3" /> Add Rule
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {rules.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No rules defined. Add a rule or use the NLP builder above.</p>
                ) : (
                  rules.map((rule, i) => (
                    <div key={i} className="p-3 rounded-lg bg-background border border-border space-y-2" data-testid={`rule-${i}`}>
                      <div className="flex items-center justify-between">
                        <div className="grid grid-cols-3 gap-3 flex-1">
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">ID</Label>
                            <Input value={rule.id} onChange={(e) => updateRule(i, "id", e.target.value)} className="mt-0.5 h-8 text-xs font-code bg-card border-card-border" />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</Label>
                            <Input value={rule.name} onChange={(e) => updateRule(i, "name", e.target.value)} className="mt-0.5 h-8 text-xs bg-card border-card-border" />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Severity</Label>
                            <Select value={rule.severity} onValueChange={(v) => updateRule(i, "severity", v)}>
                              <SelectTrigger className="mt-0.5 h-8 text-xs bg-card border-card-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(["critical", "high", "medium", "low", "info"] as Severity[]).map((s) => (
                                  <SelectItem key={s} value={s}><span className="capitalize">{s}</span></SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 ml-2 text-muted-foreground hover:text-red-400" onClick={() => removeRule(i)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Pattern (regex)</Label>
                        <Input value={rule.pattern} onChange={(e) => updateRule(i, "pattern", e.target.value)} className="mt-0.5 h-8 text-xs font-code bg-card border-card-border" />
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={rule.case_sensitive !== false}
                            onCheckedChange={(v) => updateRule(i, "case_sensitive", v)}
                            className="data-[state=checked]:bg-cyan-500 scale-75"
                          />
                          <Label className="text-[10px] text-muted-foreground">Case sensitive</Label>
                        </div>
                        <div className="flex-1">
                          <Input
                            value={rule.context_requires || ""}
                            onChange={(e) => updateRule(i, "context_requires", e.target.value)}
                            placeholder="Context requires (optional regex)"
                            className="h-7 text-[11px] font-code bg-card border-card-border"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {/* LLM Config (only for llm-review type) */}
          {scanType === "llm-review" && (
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">LLM Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <Select value={llmModel} onValueChange={setLlmModel}>
                      <SelectTrigger className="mt-1 h-9 text-sm bg-background border-border" data-testid="select-llm-model">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Prompt Template</Label>
                    <Select value={promptTemplate} onValueChange={setPromptTemplate}>
                      <SelectTrigger className="mt-1 h-9 text-sm bg-background border-border" data-testid="select-prompt-template">
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="security-review">Security Review</SelectItem>
                        <SelectItem value="code-quality">Code Quality</SelectItem>
                        <SelectItem value="code-review">Code Review</SelectItem>
                        <SelectItem value="doc-coverage">Doc Coverage</SelectItem>
                        <SelectItem value="license-audit">License Audit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Focus Tags (comma-separated)</Label>
                    <Input value={focusTags} onChange={(e) => setFocusTags(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" placeholder="security, auth, input-validation" data-testid="input-focus-tags" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Max Files Per Run</Label>
                    <Input type="number" value={maxFiles} onChange={(e) => setMaxFiles(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-max-files" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Allowlist */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Allowlist</CardTitle>
                <Button variant="outline" size="sm" onClick={addAllowlistEntry} className="h-7 text-xs gap-1" data-testid="button-add-allowlist">
                  <Plus className="w-3 h-3" /> Add Entry
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {allowlist.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No allowlist entries.</p>
              ) : (
                <div className="space-y-2">
                  {allowlist.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded bg-background border border-border">
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <Input
                          value={entry.file || ""}
                          onChange={(e) => { const a = [...allowlist]; a[i] = { ...a[i], file: e.target.value }; setAllowlist(a); }}
                          placeholder="File glob"
                          className="h-7 text-xs font-code bg-card border-card-border"
                        />
                        <Input
                          value={entry.match || entry.pattern || ""}
                          onChange={(e) => { const a = [...allowlist]; a[i] = { ...a[i], match: e.target.value, pattern: "" }; setAllowlist(a); }}
                          placeholder="Match/Pattern"
                          className="h-7 text-xs font-code bg-card border-card-border"
                        />
                        <Input
                          value={entry.reason}
                          onChange={(e) => { const a = [...allowlist]; a[i] = { ...a[i], reason: e.target.value }; setAllowlist(a); }}
                          placeholder="Reason"
                          className="h-7 text-xs bg-card border-card-border"
                        />
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={() => removeAllowlistEntry(i)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Actions</CardTitle>
                <Button variant="outline" size="sm" onClick={addAction} className="h-7 text-xs gap-1" data-testid="button-add-action">
                  <Plus className="w-3 h-3" /> Add Action
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No actions configured.</p>
              ) : (
                <div className="space-y-2">
                  {actions.map((action, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded bg-background border border-border" data-testid={`action-${i}`}>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <Select value={action.type} onValueChange={(v: any) => { const a = [...actions]; a[i] = { ...a[i], type: v }; setActions(a); }}>
                          <SelectTrigger className="h-7 text-xs bg-card border-card-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="email-report">Email Report</SelectItem>
                            <SelectItem value="generate-fix-prompt">Generate Fix Prompt</SelectItem>
                            <SelectItem value="github-issue">GitHub Issue</SelectItem>
                            <SelectItem value="generate-prompt">Generate Prompt</SelectItem>
                            <SelectItem value="in-app-notify">In-App Notify</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={action.trigger} onValueChange={(v: any) => { const a = [...actions]; a[i] = { ...a[i], trigger: v }; setActions(a); }}>
                          <SelectTrigger className="h-7 text-xs bg-card border-card-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="always">Always</SelectItem>
                            <SelectItem value="findings">On Findings</SelectItem>
                            <SelectItem value="fixed">On Fixed</SelectItem>
                          </SelectContent>
                        </Select>
                        {action.type === "email-report" && (
                          <Input
                            value={action.recipients?.join(", ") || ""}
                            onChange={(e) => {
                              const a = [...actions];
                              a[i] = { ...a[i], recipients: e.target.value.split(",").map((r) => r.trim()).filter(Boolean) };
                              setActions(a);
                            }}
                            placeholder="email@example.com, other@example.com"
                            className="h-7 text-xs bg-card border-card-border"
                          />
                        )}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={() => removeAction(i)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-3 pt-2 pb-8">
        <Button variant="outline" onClick={() => navigate("/tasks")} className="h-9" data-testid="button-cancel">
          <X className="w-4 h-4 mr-1.5" /> Cancel
        </Button>
        <Button className="h-9" onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-task">
          <Save className="w-4 h-4 mr-1.5" /> {isNew ? "Create Task" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
