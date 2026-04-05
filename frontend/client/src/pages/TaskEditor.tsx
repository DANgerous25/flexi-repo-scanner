import { useState, useMemo } from 'react';
import { useRoute, useLocation, useParams } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SeverityBadge } from '@/components/StatusBadge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { fetchTask, createTask, updateTask, fetchConnections, fetchModels, generateRules } from '@/lib/api';
import type { Task, Connection, LLMModel, PatternRule, AllowlistEntry, TaskAction, Severity, AstRule, AstNodePattern } from '@/lib/types';
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
} from 'lucide-react';

interface AstNodePatternEditorProps {
  pattern: AstNodePattern;
  onUpdate: (updatedPattern: AstNodePattern) => void;
  onRemove?: () => void;
  isRoot?: boolean;
}

const AstNodePatternEditor: React.FC<AstNodePatternEditorProps> = ({
  pattern,
  onUpdate,
  onRemove,
  isRoot = false,
}) => {
  const updateProperty = (key: string, value: any) => {
    onUpdate({
      ...pattern,
      properties: { ...pattern.properties, [key]: value },
    });
  };

  const updateConstraint = (key: string, value: any) => {
    onUpdate({
      ...pattern,
      constraints: { ...pattern.constraints, [key]: value },
    });
  };

  const addChildPattern = () => {
    onUpdate({
      ...pattern,
      children: [...(pattern.children || []), { node_type: '' }],
    });
  };

  const updateChildPattern = (index: number, updatedChild: AstNodePattern) => {
    const newChildren = [...(pattern.children || [])];
    newChildren[index] = updatedChild;
    onUpdate({ ...pattern, children: newChildren });
  };

  const removeChildPattern = (index: number) => {
    const newChildren = (pattern.children || []).filter((_, i) => i !== index);
    onUpdate({ ...pattern, children: newChildren });
  };

  return (
    <div className={`p-3 rounded-lg border ${isRoot ? 'border-border bg-background' : 'border-dashed border-gray-600 bg-gray-900'} space-y-2`}>
      <div className="flex items-center gap-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex-shrink-0">Node Type</Label>
        <Input
          value={pattern.node_type}
          onChange={(e) => onUpdate({ ...pattern, node_type: e.target.value })}
          className="h-7 text-xs font-code bg-card border-card-border"
          placeholder="e.g., Call, FunctionDef"
        />
        {!isRoot && onRemove && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={onRemove}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Properties (JSON)</Label>
        <Textarea
          value={JSON.stringify(pattern.properties, null, 2)}
          onChange={(e) => {
            try {
              updateProperty('', JSON.parse(e.target.value));
            } catch (error) {
              // Handle invalid JSON
            }
          }}
          className="h-16 text-xs font-code bg-card border-card-border resize-y"
          placeholder='{
  "name": "eval",
  "attr": "value"
}'
        />
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Value Regex</Label>
        <Input
          value={pattern.value_regex || ''}
          onChange={(e) => onUpdate({ ...pattern, value_regex: e.target.value || undefined })}
          className="h-7 text-xs font-code bg-card border-card-border"
          placeholder="e.g., (SECRET_KEY|PASSWORD)"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Constraints (JSON)</Label>
        <Textarea
          value={JSON.stringify(pattern.constraints, null, 2)}
          onChange={(e) => {
            try {
              updateConstraint('', JSON.parse(e.target.value));
            } catch (error) {
              // Handle invalid JSON
            }
          }}
          className="h-16 text-xs font-code bg-card border-card-border resize-y"
          placeholder='{
  "args_count": { "min": 5 }
}'
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Child Patterns</Label>
          <Button type="button" variant="outline" size="sm" onClick={addChildPattern} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" /> Add Child
          </Button>
        </div>
        {(pattern.children || []).map((child, index) => (
          <AstNodePatternEditor
            key={index}
            pattern={child}
            onUpdate={(updatedChild) => updateChildPattern(index, updatedChild)}
            onRemove={() => removeChildPattern(index)}
          />
        ))}
      </div>
    </div>
  );
};

interface AstRuleEditorProps {
  rule: AstRule;
  onUpdate: (updatedRule: AstRule) => void;
  onRemove: () => void;
}

const AstRuleEditor: React.FC<AstRuleEditorProps> = ({
  rule,
  onUpdate,
  onRemove,
}) => {
  const updatePattern = (updatedPattern: AstNodePattern) => {
    onUpdate({ ...rule, pattern: updatedPattern });
  };

  return (
    <div className="p-3 rounded-lg bg-background border border-border space-y-2">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">ID</Label>
            <Input value={rule.id} onChange={(e) => onUpdate({ ...rule, id: e.target.value })} className="mt-0.5 h-8 text-xs font-code bg-card border-card-border" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</Label>
            <Input value={rule.name} onChange={(e) => onUpdate({ ...rule, name: e.target.value })} className="mt-0.5 h-8 text-xs bg-card border-card-border" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Severity</Label>
            <Select value={rule.severity} onValueChange={(v) => onUpdate({ ...rule, severity: v })}>
              <SelectTrigger className="mt-0.5 h-8 text-xs bg-card border-card-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
                  <SelectItem key={s} value={s}><span className="capitalize">{s}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-2 text-muted-foreground hover:text-red-400" onClick={onRemove}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Description</Label>
        <Textarea value={rule.description || ''} onChange={(e) => onUpdate({ ...rule, description: e.target.value })} className="mt-0.5 h-16 text-xs bg-card border-card-border resize-y" />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Language</Label>
        <Input value={rule.language} onChange={(e) => onUpdate({ ...rule, language: e.target.value })} className="mt-0.5 h-8 text-xs font-code bg-card border-card-border" placeholder="python, javascript, all" />
      </div>
      <AstNodePatternEditor pattern={rule.pattern} onUpdate={updatePattern} isRoot />
    </div>
  );
};

export default function TaskEditor() {
  const params = useParams();
  const [location, navigate] = useLocation();
  const isNew = location === '/tasks/new';
  const taskId = params?.id ?? null;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: existingTask, isLoading: taskLoading } = useQuery<Task>({
    queryKey: [`/api/tasks/${taskId}`],
    queryFn: () => fetchTask(taskId!),
    enabled: !!taskId && !isNew,
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['/api/connections'],
    queryFn: fetchConnections,
  });

  const { data: models = [] } = useQuery<LLMModel[]>({
    queryKey: ['/api/settings/models'],
    queryFn: fetchModels,
  });

  const [initialized, setInitialized] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [connection, setConnection] = useState('');
  const [scanType, setScanType] = useState('pattern');
  const [scanMode, setScanMode] = useState('full');
  const [cron, setCron] = useState('0 8 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [includeGlobs, setIncludeGlobs] = useState('**/*');
  const [excludeGlobs, setExcludeGlobs] = useState('node_modules/, dist/');
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [astRules, setAstRules] = useState<AstRule[]>([]);
  const [preferredModels, setPreferredModels] = useState<string[]>(['', '', '']);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [focusTags, setFocusTags] = useState('');
  const [maxFiles, setMaxFiles] = useState('50');
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [actions, setActions] = useState<TaskAction[]>([]);
  const [builderPrompt, setBuilderPrompt] = useState('');
  const [refinementPrompt, setRefinementPrompt] = useState('');
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

  // Sort models
  const sortedModels = useMemo(() => {
    const sorted = [...models].sort((a, b) => {
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      const provCmp = a.provider.localeCompare(b.provider);
      if (provCmp !== 0) return provCmp;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [models]);

  // Group models
  const modelGroups = useMemo(() => {
    const configuredByProvider: Record<string, LLMModel[]> = {};
    const unconfiguredByProvider: Record<string, LLMModel[]> = {};
    for (const m of sortedModels) {
      const bucket = m.configured ? configuredByProvider : unconfiguredByProvider;
      if (!bucket[m.provider]) bucket[m.provider] = [];
      bucket[m.provider].push(m);
    }
    return { configured: configuredByProvider, unconfigured: unconfiguredByProvider };
  }, [sortedModels]);

  // Initialize form
  if (existingTask && !initialized) {
    setName(existingTask.name || '');
    setDescription(existingTask.description || '');
    setConnection(existingTask.connection || '');
    setScanType(existingTask.scan.type || 'pattern');
    setScanMode(existingTask.scan.mode || 'full');
    setCron(existingTask.schedule.cron || '0 8 * * *');
    setTimezone(existingTask.schedule.timezone || 'UTC');
    setIncludeGlobs(existingTask.scan.paths.include.join(', ') || '**/*');
    setExcludeGlobs(existingTask.scan.paths.exclude.join(', ') || 'node_modules/, dist/');
    setRules(existingTask.scan.rules || []);
    setAstRules(existingTask.scan.ast_rules || []);
    const pm = existingTask.scan.llm?.preferred_models;
    if (pm && pm.length > 0) {
      setPreferredModels([pm[0] || '', pm[1] || '', pm[2] || '']);
    } else {
      setPreferredModels([existingTask.scan.llm?.model || '', '', '']);
    }
    setPromptTemplate(existingTask.scan.llm?.prompt_template || '');
    setFocusTags(existingTask.scan.llm?.focus?.join(', ') || '');
    setMaxFiles(existingTask.scan.llm?.max_files_per_run?.toString() || '50');
    setAllowlist(existingTask.scan.allowlist || []);
    setActions(existingTask.actions || []);
    setBuilderPrompt(existingTask.task_builder_prompt || '');
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) => {
      if (isNew) return createTask(config);
      return updateTask(taskId!, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: isNew ? 'Task created' : 'Task updated' });
      navigate('/tasks');
    },
    onError: (err: Error) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleSave = async () => {
    let mergedAllowlist = allowlist;
    if (taskId && !isNew) {
      try {
        const freshTask = await fetchTask(taskId);
        const serverAllowlist = freshTask.scan?.allowlist || [];
        const localKeys = new Set(
          mergedAllowlist.map((e) => `${e.file || ''}|${e.pattern || ''}|${e.match || ''}`)
        );
        for (const entry of serverAllowlist) {
          const key = `${entry.file || ''}|${entry.pattern || ''}|${entry.match || ''}`;
          if (!localKeys.has(key)) {
            mergedAllowlist = [...mergedAllowlist, entry];
          }
        }
      } catch {}
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
          include: includeGlobs.split(',').map((g) => g.trim()).filter(Boolean),
          exclude: excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean),
        },
        ...(scanType === 'pattern' && { rules }),
        ...(scanType === 'ast-pattern' && { ast_rules: astRules }),
        llm: {
          model: preferredModels[0] || '',
          preferred_models: preferredModels.filter(Boolean),
          ...(scanType === 'llm-review'
            ? {
                prompt_template: promptTemplate || undefined,
                focus: focusTags ? focusTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
                max_files_per_run: maxFiles ? parseInt(maxFiles, 10) : undefined,
              }
            : {}),
        },
        allowlist: mergedAllowlist,
      },
      actions,
      task_builder_prompt: builderPrompt || undefined,
    };
    saveMutation.mutate(config);
  };

  const addRule = () => {
    setRules([...rules, { id: `rule-${Date.now()}`, name: '', pattern: '', severity: 'medium' }]);
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
    setAllowlist([...allowlist, { reason: '' }]);
  };

  const removeAllowlistEntry = (index: number) => {
    setAllowlist(allowlist.filter((_, i) => i !== index));
  };

  const addAction = () => {
    setActions([...actions, { type: 'in-app-notify', trigger: 'findings' }]);
  };

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    setGenerateLoading(true);
    setGeneratePreview(null);
    try {
      const result = await generateRules('create', builderPrompt);
      setGeneratePreview(result);
    } catch (err: any) {
      toast({ title: 'Generation failed', description: err.message, variant: 'destructive' });
    } finally {
      setGenerateLoading(false);
    }
  };

  const applyGeneratedRules = (mode: 'add' | 'replace') => {
    if (!generatePreview?.parsed) return;
    const parsed = generatePreview.parsed as { rules?: any[] };
    const newRules: PatternRule[] = (parsed.rules || []).map((r: any) => ({
      id: r.id || `rule-${Date.now()}`,
      name: r.name || '',
      pattern: r.pattern || '',
      severity: r.severity || 'medium',
      case_sensitive: r.case_sensitive,
      context_requires: r.context_requires,
    }));
    if (newRules.length > 0) {
      if (mode === 'add') {
        setRules([...rules, ...newRules]);
        toast({ title: 'Rules added', description: `${newRules.length} rule(s) appended to existing ${rules.length} rule(s)` });
      } else {
        setRules(newRules);
        toast({ title: 'Rules replaced', description: `All rules replaced with ${newRules.length} new rule(s)` });
      }
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
        include: includeGlobs.split(',').map((g) => g.trim()).filter(Boolean),
        exclude: excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean),
      },
      ...(scanType === 'pattern' && { rules }),
      llm: {
        model: preferredModels[0] || '',
        preferred_models: preferredModels.filter(Boolean),
      },
      allowlist: allowlist.length > 0 ? allowlist : undefined,
    },
    actions,
  });

  const handleRefine = async () => {
    setRefineLoading(true);
    setRefinePreview(null);
    try {
      const result = await generateRules('refine', refinementPrompt, buildCurrentConfig());
      setRefinePreview(result);
    } catch (err: any) {
      toast({ title: 'Refinement failed', description: err.message, variant: 'destructive' });
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

    if (p.rules_to_add?.length) {
      for (const r of p.rules_to_add) {
        updated.push({ id: r.id || `rule-${Date.now()}`, name: r.name || '', pattern: r.pattern || '', severity: r.severity || 'medium', case_sensitive: r.case_sensitive, context_requires: r.context_requires });
      }
    }

    if (p.rules_to_modify?.length) {
      for (const mod of p.rules_to_modify) {
        const idx = updated.findIndex((r) => r.id === mod.id);
        if (idx !== -1 && mod.changes) {
          updated[idx] = { ...updated[idx], ...mod.changes };
        }
      }
    }

    if (p.rules_to_remove?.length) {
      const idsToRemove = new Set(p.rules_to_remove.map((r: any) => (typeof r === 'string' ? r : r.id)));
      updated = updated.filter((r) => !idsToRemove.has(r.id));
    }

    setRules(updated);

    if (p.allowlist_to_add?.length) {
      const newEntries: AllowlistEntry[] = p.allowlist_to_add.map((a: any) => ({ file: a.file, match: a.match, pattern: a.pattern, rules: a.rules, reason: a.reason || '' }));
      setAllowlist([...allowlist, ...newEntries]);
    }

    if (p.paths_to_exclude?.length) {
      const current = excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean);
      const merged = [...current, ...p.paths_to_exclude];
      setExcludeGlobs(merged.join(', '));
    }

    toast({ title: 'Refinements applied', description: 'Suggestions merged into current config' });
    setRefinePreview(null);
  };

  const yamlContent = `id: "${taskId || 'new-task'}"
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
    include: [${includeGlobs.split(',').map((g) => `"${g.trim()}"`).join(', ')}]
    exclude: [${excludeGlobs.split(',').map((g) => `"${g.trim()}"`).join(', ')}]
${scanType === 'pattern' ? `  rules:\n${rules.map((r) => `    - id: "${r.id}"\n      name: "${r.name}"\n      pattern: '${r.pattern}'\n      severity: "${r.severity}"${r.case_sensitive === false ? `\n      case_sensitive: false` : ''}${r.context_requires ? `\n      context_requires: '${r.context_requires}'` : ''}`).join('\n')}` : ''}
${scanType === 'ast-pattern' ? `  ast_rules:\n${astRules.map((r) => `    - id: "${r.id}"\n      name: "${r.name}"\n      description: "${r.description || ''}"\n      severity: "${r.severity}"\n      language: "${r.language}"\n      pattern: ${JSON.stringify(r.pattern, null, 2).replace(/\n/g, '\n      ')}` ).join('\n')}` : ''}
  llm:
    preferred_models: [${preferredModels.filter(Boolean).map((m) => `"${m}"`).join(', ')}]
${scanType === 'llm-review' ? `    prompt_template: "${promptTemplate}"\n    focus: [${focusTags.split(',').map((t) => `"${t.trim()}"`).join(', ')}]\n    max_files_per_run: ${maxFiles}` : ''}
actions:
${actions.map((a) => `  - type: "${a.type}"\n    trigger: "${a.trigger}"${a.recipients ? `\n    recipients: [${a.recipients.map((r) => `"${r}"`).join(', ')}]` : ''}`).join('\n')}`;

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
      {/* Top section */}
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

      {/* Form/YAML toggle */}
      <div className="flex items-center justify-end gap-2">
        <Button variant={showYaml ? 'outline' : 'secondary'} size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowYaml(false)}><FileText className="w-3.5 h-3.5" /> Form</Button>
        <Button variant={showYaml ? 'secondary' : 'outline'} size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowYaml(true)}><Code className="w-3.5 h-3.5" /> YAML</Button>
      </div>

      {showYaml ? (
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <Textarea value={yamlContent} className="font-code text-xs h-[500px] bg-background border-border resize-none" data-testid="textarea-yaml" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
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
                      <SelectItem value="ast-pattern">AST Pattern</SelectItem>
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

          {scanType === 'pattern' && (
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Pattern Rules</CardTitle>
                  <Button variant="outline" size="sm" onClick={addRule} className="h-7 text-xs gap-1" data-testid="button-add-rule"><Plus className="w-3 h-3" /> Add Rule</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {rules.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No rules defined.</p>
                ) : (
                  rules.map((rule, i) => (
                    <div key={i} className="p-3 rounded-lg bg-background border border-border space-y-2" data-testid={`rule-${i}`}>
                      <div className="flex items-center justify-between">
                        <div className="grid grid-cols-3 gap-3 flex-1">
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">ID</Label>
                            <Input value={rule.id} onChange={(e) => updateRule(i, 'id', e.target.value)} className="mt-0.5 h-8 text-xs font-code bg-card border-card-border" />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</Label>
                            <Input value={rule.name} onChange={(e) => updateRule(i, 'name', e.target.value)} className="mt-0.5 h-8 text-xs bg-card border-card-border" />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Severity</Label>
                            <Select value={rule.severity} onValueChange={(v) => updateRule(i, 'severity', v)}>
                              <SelectTrigger className="mt-0.5 h-8 text-xs bg-card border-card-border"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
                                  <SelectItem key={s} value={s}><span className="capitalize">{s}</span></SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 ml-2 text-muted-foreground hover:text-red-400" onClick={() => removeRule(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Pattern (regex)</Label>
                        <Input value={rule.pattern} onChange={(e) => updateRule(i, 'pattern', e.target.value)} className="mt-0.5 h-8 text-xs font-code bg-card border-card-border" />
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Switch checked={rule.case_sensitive !== false} onCheckedChange={(v) => updateRule(i, 'case_sensitive', v)} className="data-[state=checked]:bg-cyan-500 scale-75" />
                          <Label className="text-[10px] text-muted-foreground">Case sensitive</Label>
                        </div>
                        <div className="flex-1">
                          <Input value={rule.context_requires || ''} onChange={(e) => updateRule(i, 'context_requires', e.target.value)} placeholder="Context requires (optional regex)" className="h-7 text-[11px] font-code bg-card border-card-border" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {scanType === 'ast-pattern' && (
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">AST Pattern Rules</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setAstRules([...astRules, { id: `ast-rule-${Date.now()}`, name: 'New AST Rule', language: 'python', pattern: { node_type: '' } }])} className="h-7 text-xs gap-1" data-testid="button-add-ast-rule"><Plus className="w-3 h-3" /> Add AST Rule</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {astRules.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No AST rules defined.</p>
                ) : (
                  astRules.map((rule, i) => (
                    <AstRuleEditor
                      key={i}
                      rule={rule}
                      onUpdate={(updatedRule) => {
                        const a = [...astRules];
                        a[i] = updatedRule;
                        setAstRules(a);
                      }}
                      onRemove={() => setAstRules(astRules.filter((_, idx) => idx !== i))}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {/* ... other sections like LLM config, Allowlist, Actions */}

        </div>
      )}

      {/* Footer */}
      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 py-3 px-4 -mx-4 mt-6 bg-background/95 backdrop-blur border-t border-border">
        <Button variant="outline" onClick={() => navigate('/tasks')} className="h-9" data-testid="button-cancel"><X className="w-4 h-4 mr-1.5" /> Cancel</Button>
        <Button className="h-9" onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-task"><Save className="w-4 h-4 mr-1.5" /> {isNew ? 'Create Task' : 'Save Changes'}</Button>
      </div>
    </div>
  );
}
