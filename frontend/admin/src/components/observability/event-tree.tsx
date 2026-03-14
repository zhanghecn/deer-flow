import { useState } from "react";
import { Bot, ChevronRight, Gauge, Hammer, Link2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAgo, formatDateTime } from "@/lib/format";
import { TraceRunDialog } from "./trace-run-dialog";
import { isMiddlewareRun, type TraceRunSummary } from "./trace-run-utils";

interface EventTreeProps {
  runs: TraceRunSummary[];
}

function runTypeIcon(runType: string) {
  switch (runType) {
    case "llm":
      return <Bot className="h-3.5 w-3.5 text-purple-500" />;
    case "tool":
      return <Hammer className="h-3.5 w-3.5 text-amber-500" />;
    case "chain":
      return <Link2 className="h-3.5 w-3.5 text-blue-500" />;
    case "system":
      return <Gauge className="h-3.5 w-3.5 text-emerald-500" />;
    default:
      return <Workflow className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function statusVariant(status: string) {
  if (status === "error") return "destructive" as const;
  if (status === "completed") return "default" as const;
  return "secondary" as const;
}

function errorText(run: TraceRunSummary): string | null {
  return run.errorEvent?.error ?? null;
}

export function EventTree({ runs }: EventTreeProps) {
  const [selectedRun, setSelectedRun] = useState<TraceRunSummary | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (!runs.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No runs
      </p>
    );
  }

  return (
    <>
      <div className="space-y-1.5">
        {runs.map((run) => {
          const runError = errorText(run);

          return (
            <button
              key={run.runId}
              type="button"
              onClick={() => {
                setSelectedRun(run);
                setIsDialogOpen(true);
              }}
              className={cn(
                "w-full rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent/40",
                run.status === "error" && "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20",
              )}
              style={{ paddingLeft: `${run.depth * 20 + 12}px` }}
            >
              <div className="flex items-start gap-2">
                {run.depth > 0 && (
                  <ChevronRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
                <div className="mt-0.5 shrink-0">{runTypeIcon(run.runType)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      {run.runType}
                    </Badge>
                    <Badge variant={statusVariant(run.status)} className="text-xs px-1.5 py-0">
                      {run.status}
                    </Badge>
                    {isMiddlewareRun(run) && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        middleware
                      </Badge>
                    )}
                    {run.taskRunId && (
                      <Badge variant="outline" className="text-xs px-1.5 py-0">
                        sub-agent
                      </Badge>
                    )}
                    {run.hasReasoning && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 px-1.5 py-0 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300"
                      >
                        reasoning
                      </Badge>
                    )}
                    {run.hasTruncatedPayload && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 px-1.5 py-0 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300"
                      >
                        trace truncated
                      </Badge>
                    )}
                    <span className="text-sm font-medium">{run.label}</span>
                  </div>

                  <p className="mt-1 text-sm text-foreground/90 break-words">
                    {run.summary || "Run details"}
                  </p>
                  {run.reasoningPreview && (
                    <p className="mt-1 break-words text-xs text-amber-700 dark:text-amber-300">
                      Reasoning: {run.reasoningPreview}
                    </p>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDateTime(run.startedAt)}</span>
                    {run.startedAt && <span>{formatAgo(run.startedAt)}</span>}
                    {(run.totalTokens != null && run.totalTokens > 0) && (
                      <span className="tabular-nums">
                        {run.inputTokens ?? 0}↓ {run.outputTokens ?? 0}↑
                      </span>
                    )}
                    {run.durationMs != null && (
                      <span className="tabular-nums">{run.durationMs}ms</span>
                    )}
                    <span>{run.eventCount} evt</span>
                  </div>

                  {runError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400 break-all">
                      {runError}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <TraceRunDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        run={selectedRun}
      />
    </>
  );
}
