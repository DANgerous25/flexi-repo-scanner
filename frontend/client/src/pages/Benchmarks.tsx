import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RunStatusBadge } from "@/components/StatusBadge";
import { mockTasks, mockBenchmarks, mockModels } from "@/lib/mock-data";
import {
  FlaskConical,
  Play,
  Trophy,
  Clock,
  Coins,
  Hash,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";

export default function Benchmarks() {
  const [selectedTask, setSelectedTask] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  const llmTasks = mockTasks.filter((t) => t.scan.type === "llm-review");

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((m) => m !== modelId)
        : prev.length < 5
        ? [...prev, modelId]
        : prev
    );
  };

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Start Benchmark */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Start Benchmark</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Select an LLM task to benchmark</p>
            <Select value={selectedTask} onValueChange={setSelectedTask}>
              <SelectTrigger className="w-72 h-9 text-sm bg-background border-border" data-testid="select-benchmark-task">
                <SelectValue placeholder="Select task" />
              </SelectTrigger>
              <SelectContent>
                {llmTasks.length === 0 ? (
                  <SelectItem value="_none" disabled>No LLM tasks available</SelectItem>
                ) : (
                  llmTasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Select models to compare (2-5)</p>
            <div className="flex flex-wrap gap-2">
              {mockModels.map((model) => (
                <label
                  key={model.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors text-xs ${
                    selectedModels.includes(model.id)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted"
                  }`}
                  data-testid={`checkbox-model-${model.id}`}
                >
                  <Checkbox
                    checked={selectedModels.includes(model.id)}
                    onCheckedChange={() => toggleModel(model.id)}
                    className="h-3.5 w-3.5"
                  />
                  {model.name}
                </label>
              ))}
            </div>
          </div>

          <Button
            size="sm"
            className="h-9 gap-1.5"
            disabled={!selectedTask || selectedModels.length < 2}
            data-testid="button-run-benchmark"
          >
            <Play className="w-4 h-4" />
            Run Benchmark
          </Button>
        </CardContent>
      </Card>

      {/* Benchmark Results */}
      {mockBenchmarks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Previous Results</h2>
          {mockBenchmarks.map((bench) => (
            <Card key={bench.id} className="bg-card border-card-border" data-testid={`card-benchmark-${bench.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FlaskConical className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{bench.task_name}</h3>
                      <p className="text-[11px] text-muted-foreground">{format(new Date(bench.started_at), "MMM d, yyyy HH:mm")}</p>
                    </div>
                  </div>
                  <RunStatusBadge status={bench.status} />
                </div>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Model</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">
                      <div className="flex items-center justify-end gap-1"><Hash className="w-3 h-3" />Findings</div>
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">
                      <div className="flex items-center justify-end gap-1"><TrendingUp className="w-3 h-3" />Unique</div>
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">False Pos.</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">
                      <div className="flex items-center justify-end gap-1"><Clock className="w-3 h-3" />Time</div>
                    </TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">In Tokens</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">Out Tokens</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-right">
                      <div className="flex items-center justify-end gap-1"><Coins className="w-3 h-3" />Cost</div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bench.models.map((model, i) => {
                    const isBest = model.findings_count === Math.max(...bench.models.map((m) => m.findings_count));
                    return (
                      <TableRow key={model.model} className="border-border" data-testid={`row-benchmark-model-${i}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {isBest && <Trophy className="w-3.5 h-3.5 text-amber-400" />}
                            <span className="text-sm font-medium text-foreground">{model.model_name}</span>
                            {model.status === "running" && <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm font-medium text-cyan-400">{model.findings_count}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm text-foreground">{model.unique_findings}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm ${model.estimated_false_positives > 2 ? "text-amber-400" : "text-foreground"}`}>
                            {model.estimated_false_positives}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm text-muted-foreground">{model.duration_seconds.toFixed(1)}s</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs font-code text-muted-foreground">{model.input_tokens.toLocaleString()}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs font-code text-muted-foreground">{model.output_tokens.toLocaleString()}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-medium ${model.estimated_cost === 0 ? "text-emerald-400" : "text-foreground"}`}>
                            ${model.estimated_cost.toFixed(2)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
