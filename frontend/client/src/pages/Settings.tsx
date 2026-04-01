import { useState, useEffect } from "react";
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
} from "lucide-react";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading, error } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    queryFn: fetchSettings,
  });

  // OpenRouter models query
  const { data: openRouterModels, isLoading: loadingORModels } = useQuery({
    queryKey: ["/api/settings/openrouter-models"],
    queryFn: fetchOpenRouterModels,
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

  // OpenRouter model selection state
  const [orSearch, setOrSearch] = useState("");
  const [orSelectedModel, setOrSelectedModel] = useState("");

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
    // Pre-select the current OpenRouter model
    const orProvider = settings.llm?.providers?.openrouter;
    if (orProvider?.models?.[0]) {
      setOrSelectedModel(orProvider.models[0].id);
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

  // OpenRouter model change handler
  const handleSetOpenRouterModel = (modelId: string) => {
    setOrSelectedModel(modelId);
    const modelName = openRouterModels?.find((m) => m.id === modelId)?.name ?? modelId;
    const currentProviders = settings?.llm?.providers ?? {};
    saveMutation.mutate({
      llm: {
        ...currentProviders,
        openrouter: {
          ...currentProviders.openrouter,
          models: [{ id: modelId, name: modelName }],
        },
      },
    } as unknown as Partial<Settings>);
  };

  // Filter OpenRouter models by search
  const filteredORModels = (openRouterModels ?? []).filter(
    (m) => !orSearch || m.id.toLowerCase().includes(orSearch.toLowerCase()) || m.name.toLowerCase().includes(orSearch.toLowerCase())
  ).slice(0, 30);

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
          <div className="space-y-3">
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

                  <div>
                    <Label className="text-xs text-muted-foreground">Models</Label>
                    {providerName === "openrouter" ? (
                      <div className="mt-1.5 space-y-2">
                        <div className="flex items-center justify-between p-2 rounded bg-background border border-border">
                          <div>
                            <span className="text-xs font-medium text-foreground">Active model:</span>
                            <span className="text-[10px] font-code text-muted-foreground ml-2">{orSelectedModel || "Not set"}</span>
                          </div>
                        </div>
                        <Input
                          placeholder="Search OpenRouter models..."
                          value={orSearch}
                          onChange={(e) => setOrSearch(e.target.value)}
                          className="h-8 text-xs bg-background border-border"
                        />
                        <div className="max-h-48 overflow-y-auto space-y-1 border rounded bg-background">
                          {loadingORModels ? (
                            <div className="p-2 text-xs text-muted-foreground">Loading models...</div>
                          ) : filteredORModels.length === 0 ? (
                            <div className="p-2 text-xs text-muted-foreground">No models found</div>
                          ) : (
                            filteredORModels.map((model) => (
                              <button
                                key={model.id}
                                className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                                onClick={() => handleSetOpenRouterModel(model.id)}
                              >
                                <span className="font-medium">{model.name}</span>
                                <span className="ml-2 text-[10px] text-muted-foreground font-code">{model.id}</span>
                                {orSelectedModel === model.id && (
                                  <span className="ml-2 text-[10px] text-cyan-500">✓</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
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
                    )}
                  </div>
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
