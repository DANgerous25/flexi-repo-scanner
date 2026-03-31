import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { mockSettings } from "@/lib/mock-data";
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
} from "lucide-react";

export default function Settings() {
  const [smtpHost, setSmtpHost] = useState(mockSettings.smtp.host);
  const [smtpPort, setSmtpPort] = useState(mockSettings.smtp.port.toString());
  const [smtpTls, setSmtpTls] = useState(mockSettings.smtp.tls);
  const [smtpUser, setSmtpUser] = useState(mockSettings.smtp.username);
  const [smtpPass, setSmtpPass] = useState(mockSettings.smtp.password);
  const [smtpFrom, setSmtpFrom] = useState(mockSettings.smtp.from_address);
  const [smtpFromName, setSmtpFromName] = useState(mockSettings.smtp.from_name);
  const [retentionDays, setRetentionDays] = useState(mockSettings.retention.results_days);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});

  const handleTestSmtp = () => {
    setTestingSmtp(true);
    setTimeout(() => setTestingSmtp(false), 2000);
  };

  const handleTestModel = (modelId: string) => {
    setTestingModel(modelId);
    setTimeout(() => setTestingModel(null), 2000);
  };

  const toggleShowKey = (provider: string) => {
    setShowApiKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

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
                <Button size="sm" className="h-8 text-xs" data-testid="button-save-smtp">
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LLM Providers Tab */}
        <TabsContent value="llm">
          <div className="space-y-3">
            {Object.entries(mockSettings.llm.providers).map(([providerName, provider]) => (
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
              <Button size="sm" className="h-8 text-xs" data-testid="button-save-retention">
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
                  <Input value={mockSettings.server.host} className="mt-1 h-9 text-sm font-code bg-background border-border opacity-70" readOnly data-testid="input-server-host" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <Input value={mockSettings.server.port.toString()} className="mt-1 h-9 text-sm font-code bg-background border-border opacity-70" readOnly data-testid="input-server-port" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
