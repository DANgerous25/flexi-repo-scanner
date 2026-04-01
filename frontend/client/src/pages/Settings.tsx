import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { fetchSettings, saveSettings, testSmtp, testLlm, fetchOpenRouterModels } from "@/lib/api";
import type { Settings } from "@/lib/types";
import {
  Mail,
  Server,
  Brain,
  Trash2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  Clock,
  AlertTriangle,
  ChevronsUpDown,
  GripVertical,
  X,
  Plus,
  Search,
} from "lucide-react";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading, error } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    queryFn: fetchSettings,
  });

  // OpenRouter models
  const { data: openRouterModels, isLoading: loadingOpenRouterModels } = useQuery({
    queryKey: ["/api/settings/openrouter-models"],
    queryFn: fetchOpenRouterModels,
    enabled: !!settings?.llm?.providers?.openrouter,
  });

  const [initialized, setInitialized] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpTls, setSmtpTls] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});

  // Fallback order state
  const [fallbackOrder, setFallbackOrder] = useState<string[]>([]);
  const [openRouterModelOpen, setOpenRouterModelOpen] = useState(false);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState<string>("");

  // Initialize form from API data
  if (settings && !initialized) {
    setSmtpHost(settings.smtp?.host || "");
    setSmtpPort(settings.smtp?.port?.toString() || "");
    setSmtpTls(settings.smtp?.tls ?? false);
    setSmtpUser(settings.smtp?.username || "");
    setSmtpPass(settings.smtp?.password || "");
    setSmtpFrom(settings.smtp?.from_address || "");
    setSmtpFromName(settings.smtp?.from_name || "");
    setRetentionDays(settings.retention?.results_days ?? 30);
    setFallbackOrder(settings.llm?.fallback_order ?? []);
    // Set the first model in OpenRouter's list as selected
    const orModels = settings.llm?.providers?.openrouter?.models ?? [];
    if (orModels.length > 0) {
      setSelectedOpenRouterModel(orModels[0].id);
    }
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Settings>) => saveSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveSmtp = () => {
    saveMutation.mutate({
      smtp: {
        host: smtpHost,
        port: parseInt(smtpPort, 10) || 587,
        tls: smtpTls,
        username: smtpUser,
        password: smtpPass,
        from_address: smtpFrom,
        from_name: smtpFromName,
      },
    } as Partial<Settings>);
  };

  const handleSaveRetention = () => {
    saveMutation.mutate({
      retention: {
        results_days: retentionDays,
        max_days: 0,
      },
    } as Partial<Settings>);
  };

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    try {
      const result = await testSmtp();
      toast({ title: result.success ? "SMTP test successful" : "SMTP test failed", description: result.message });
    } catch (err: any) {
      toast({ title: "SMTP test failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleTestModel = async (modelId: string) => {
    setTestingModel(modelId);
    try {
      const result = await testLlm(modelId);
      toast({ title: result.success ? "Model test successful" : "Model test failed", description: result.message });
    } catch (err: any) {
      toast({ title: "Model test failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingModel(null);
    }
  };

  const toggleShowKey = (provider: string) => {
    setShowApiKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  // ── Fallback order handlers ──────────────────────────────────────────
  const handleAddFallback = (provider: string) => {
    if (!fallbackOrder.includes(provider)) {
      setFallbackOrder([...fallbackOrder, provider]);
    }
    setOpenRouterModelOpen(false);
  };

  const handleRemoveFallback = (provider: string) => {
    setFallbackOrder(fallbackOrder.filter((p) => p !== provider));
  };

  const handleMoveFallback = (index: number, direction: "up" | "down") => {
    const newOrder = [...fallbackOrder];
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setFallbackOrder(newOrder);
  };

  const handleSaveFallbackOrder = () => {
    saveMutation.mutate({
      llm: { fallback_order: fallbackOrder, providers: settings!.llm?.providers ?? {} },
    } as Partial<Settings>);
  };

  // ── OpenRouter model handlers ────────────────────────────────────────
  const handleSelectOpenRouterModel = (modelId: string) => {
    setSelectedOpenRouterModel(modelId);
    setOpenRouterModelOpen(false);
  };

  const handleAddOpenRouterModel = () => {
    if (!selectedOpenRouterModel) return;
    const currentModels = settings!.llm?.providers?.openrouter?.models ?? [];
    if (currentModels.some((m) => m.id === selectedOpenRouterModel)) {
      toast({ title: "Model already added", variant: "destructive" });
      return;
    }
    const modelName = openRouterModels?.find((m) => m.id === selectedOpenRouterModel)?.name ?? selectedOpenRouterModel;
    const newProviders = {
      ...settings!.llm?.providers ?? {},
      openrouter: {
        ...settings!.llm?.providers?.openrouter ?? {},
        models: [...currentModels, { id: selectedOpenRouterModel, name: modelName, provider: "openrouter", configured: true }],
      },
    };
    saveMutation.mutate({
      llm: { fallback_order: fallbackOrder, providers: newProviders },
    } as Partial<Settings>);
  };

  const handleRemoveOpenRouterModel = (modelId: string) => {
    const currentModels = settings!.llm?.providers?.openrouter?.models ?? [];
    const newProviders = {
      ...settings!.llm?.providers ?? {},
      openrouter: {
        ...settings!.llm?.providers?.openrouter ?? {},
        models: currentModels.filter((m) => m.id !== modelId),
      },
    };
    saveMutation.mutate({
      llm: { fallback_order: fallbackOrder, providers: newProviders },
    } as Partial<Settings>);
  };

  // Available providers for fallback (excluding those already in the list)
  const availableProviders = Object.keys(settings!.llm?.providers ?? {}).filter(
    (p) => !fallbackOrder.includes(p)
  );

  // Filtered OpenRouter models
  const filteredOpenRouterModels = openRouterModels ?? [];

  if (isLoading) {
    return (
      <div className="max-w-[800px]">
        <Skeleton className="h-9 w-96 mb-4" />
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Failed to load settings{error ? `: ${(error as Error).message}` : ""}</p>
      </div>
    );
  }

  return (
    <div className="max-w-[800px]">
      <Tabs defaultValue="smtp" className="space-y-4">
        <TabsList className="bg-muted/50 h-9">
          <TabsTrigger value="smtp" className="text-xs gap-1.5 data-[state=active]:bg-background" data-testid="tab-smtp">
            <Mail className="w-3.5 h-3.5" /> SMTP
          </TabsTrigger>
          <TabsTrigger value="llm" className="text-xs gap-1.5 data-[state=active]:bg-background" data-testid="tab-llm">
            <Brain className="w-3.5 h-3.5" /> LLM Providers
          </TabsTrigger>
          <TabsTrigger value="retention" className="text-xs gap-1.5 data-[state=active]:bg-background" data-testid="tab-retention">
            <Clock className="w-3.5 h-3.5" /> Retention
          </TabsTrigger>
          <TabsTrigger value="server" className="text-xs gap-1.5 data-[state=active]:bg-background" data-testid="tab-server">
            <Server className="w-3.5 h-3.5" /> Server
          </TabsTrigger>
        </TabsList>

        {/* SMTP Tab */}
        <TabsContent value="smtp">
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">SMTP Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">SMTP Host</Label>
                  <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-smtp-host" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-smtp-port" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={smtpTls} onCheckedChange={setSmtpTls} className="data-[state=checked]:bg-cyan-500" data-testid="switch-smtp-tls" />
                <Label className="text-xs text-muted-foreground">Use TLS</Label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-smtp-user" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Password</Label>
                  <Input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-smtp-pass" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">From Address</Label>
                  <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-smtp-from" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">From Name</Label>
                  <Input value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} className="mt-1 h-9 text-sm bg-background border-border" data-testid="input-smtp-from-name" />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={handleTestSmtp}
                  disabled={testingSmtp}
                  data-testid="button-test-smtp"
                >
                  {testingSmtp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Send Test Email
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={handleSaveSmtp} disabled={saveMutation.isPending} data-testid="button-save-smtp">
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LLM Providers Tab */}
        <TabsContent value="llm">
          <div className="space-y-4">
            {/* Fallback Order Configuration */}
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Model Fallback Order</CardTitle>
                <p className="text-xs text-muted-foreground">Providers are tried in this order when a task runs. Drag to reorder.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  {fallbackOrder.map((provider, index) => (
                    <div key={provider} className="flex items-center gap-2 p-2 rounded bg-background border border-border">
                      <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium text-foreground flex-1 capitalize">{index + 1}. {provider}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          onClick={() => handleMoveFallback(index, "up")}
                          disabled={index === 0}
                        >
                          <span className="sr-only">Move up</span>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          onClick={() => handleMoveFallback(index, "down")}
                          disabled={index === fallbackOrder.length - 1}
                        >
                          <span className="sr-only">Move down</span>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveFallback(provider)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {fallbackOrder.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No providers in fallback order</p>
                  )}
                </div>

                {/* Add provider dropdown */}
                {availableProviders.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 w-full">
                        <Plus className="w-3.5 h-3.5" /> Add provider to fallback chain
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-2 w-48">
                      <div className="space-y-1">
                        {availableProviders.map((p) => (
                          <Button
                            key={p}
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-xs capitalize h-8"
                            onClick={() => handleAddFallback(p)}
                          >
                            {p}
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                <Button size="sm" className="h-8 text-xs" onClick={handleSaveFallbackOrder} disabled={saveMutation.isPending}>
                  Save Fallback Order
                </Button>
              </CardContent>
            </Card>

            {/* OpenRouter Model Selector */}
            {settings.llm?.providers?.openrouter && (
              <Card className="bg-card border-card-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">OpenRouter Models</CardTitle>
                  <p className="text-xs text-muted-foreground">Add models from OpenRouter's catalog to use in tasks.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Popover open={openRouterModelOpen} onOpenChange={setOpenRouterModelOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openRouterModelOpen}
                          className="flex-1 justify-between h-9 text-xs"
                        >
                          {selectedOpenRouterModel
                            ? openRouterModels?.find((m) => m.id === selectedOpenRouterModel)?.name ?? selectedOpenRouterModel
                            : "Select model..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-80">
                        <Command>
                          <CommandInput placeholder="Search models..." />
                          <CommandList>
                            <CommandEmpty>No model found.</CommandEmpty>
                            <CommandGroup className="max-h-64 overflow-auto">
                              {loadingOpenRouterModels ? (
                                <div className="py-6 text-center text-xs text-muted-foreground">Loading models...</div>
                              ) : (
                                filteredOpenRouterModels.slice(0, 50).map((model) => (
                                  <CommandItem
                                    key={model.id}
                                    value={model.id}
                                    onSelect={() => handleSelectOpenRouterModel(model.id)}
                                  >
                                    <span className="text-xs">{model.name}</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground font-code">{model.id}</span>
                                  </CommandItem>
                                ))
                              )}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <Button size="sm" className="h-9 text-xs" onClick={handleAddOpenRouterModel} disabled={!selectedOpenRouterModel || saveMutation.isPending}>
                      Add
                    </Button>
                  </div>

                  {/* Current OpenRouter models */}
                  <div className="mt-1.5 space-y-1.5">
                    {(settings.llm.providers.openrouter.models ?? []).map((model) => (
                      <div key={model.id} className="flex items-center justify-between p-2 rounded bg-background border border-border">
                        <div>
                          <span className="text-xs font-medium text-foreground">{model.name}</span>
                          <span className="text-[10px] font-code text-muted-foreground ml-2">{model.id}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => handleTestModel(model.id)}
                            disabled={testingModel === model.id}
                          >
                            {testingModel === model.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                            Test
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveOpenRouterModel(model.id)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Provider cards */}
            {Object.entries(settings.llm?.providers || {}).map(([providerName, provider]) => (
              <Card key={providerName} className="bg-card border-card-border" data-testid={`card-provider-${providerName}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground capitalize">{providerName}</h3>
                    {provider.api_key && (
                      <Badge variant="outline" className="status-completed text-[10px]">Configured</Badge>
                    )}
                  </div>

                  {provider.api_key !== undefined && (
                    <div>
                      <Label className="text-xs text-muted-foreground">API Key</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type={showApiKeys[providerName] ? "text" : "password"}
                          value={provider.api_key}
                          className="h-8 text-xs font-code bg-background border-border"
                          readOnly
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => toggleShowKey(providerName)}
                        >
                          {showApiKeys[providerName] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  )}

                  {provider.base_url && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Base URL</Label>
                      <Input value={provider.base_url} className="mt-1 h-8 text-xs font-code bg-background border-border" readOnly />
                    </div>
                  )}

                  {providerName !== "openrouter" && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Models</Label>
                      <div className="mt-1.5 space-y-1.5">
                        {provider.models.map((model) => (
                          <div key={model.id} className="flex items-center justify-between p-2 rounded bg-background border border-border">
                            <div>
                              <span className="text-xs font-medium text-foreground">{model.name}</span>
                              <span className="text-[10px] font-code text-muted-foreground ml-2">{model.id}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => handleTestModel(model.id)}
                              disabled={testingModel === model.id}
                              data-testid={`button-test-model-${model.id}`}
                            >
                              {testingModel === model.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              Test
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Retention Tab */}
        <TabsContent value="retention">
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Data Retention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs text-muted-foreground">Retain scan results for</Label>
                  <span className="text-sm font-medium text-foreground" data-testid="text-retention-value">
                    {retentionDays === 0 ? "Unlimited" : `${retentionDays} days`}
                  </span>
                </div>
                <Slider
                  value={[retentionDays]}
                  onValueChange={([v]) => setRetentionDays(v)}
                  min={0}
                  max={365}
                  step={1}
                  className="w-full"
                  data-testid="slider-retention"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Unlimited</span>
                  <span>365 days</span>
                </div>
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={handleSaveRetention} disabled={saveMutation.isPending} data-testid="button-save-retention">
                Save
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Server Tab */}
        <TabsContent value="server">
          <Card className="bg-card border-card-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Server Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">Server settings are configured in <code className="font-code text-foreground">config/settings.yaml</code>. Restart the server to apply changes.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Host</Label>
                  <Input value={settings.server?.host || ""} className="mt-1 h-9 text-sm font-code bg-background border-border opacity-70" readOnly data-testid="input-server-host" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <Input value={settings.server?.port?.toString() || ""} className="mt-1 h-9 text-sm font-code bg-background border-border opacity-70" readOnly data-testid="input-server-port" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
