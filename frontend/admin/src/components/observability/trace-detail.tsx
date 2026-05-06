import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { getCurrentLocale, t } from "@/i18n";
import { formatDate } from "@/lib/format";
import { EventTree } from "./event-tree";
import { TokenSummary } from "./token-summary";
import { useFetch } from "@/hooks/use-fetch";
import type { TraceItem, TraceEvent, TraceContextWindow } from "@/types";
import {
  buildTraceRuns,
  extractLatestLLMRequestSettings,
  extractLatestVisibleAnswer,
  extractRegisteredToolNames,
  extractContextWindowPayload,
  isCoreTraceRun,
  type TraceRunSummary,
} from "./trace-run-utils";

interface TraceDetailProps {
  trace: TraceItem | null;
  expanded?: boolean;
}

type ViewMode = "timeline" | "galaxy";
type RunFilter = "core" | "all";

const GalaxyTraceView = lazy(async () => {
  const module = await import("./galaxy-trace-view");
  return { default: module.GalaxyTraceView };
});

function extractLatestContextWindow(runs: TraceRunSummary[]): TraceContextWindow | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run) {
      continue;
    }
    const contextWindow = extractContextWindowPayload(run);
    if (!contextWindow) {
      continue;
    }
    return contextWindow as TraceContextWindow;
  }
  return null;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return `${Math.round(value * 100)}%`;
}

function formatCount(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat(getCurrentLocale()).format(Math.round(value));
}

function formatCompactionReduction(contextWindow: TraceContextWindow) {
  const before = contextWindow.approx_input_tokens;
  const after = contextWindow.approx_input_tokens_after_summary;
  if (
    typeof before !== "number" ||
    Number.isNaN(before) ||
    typeof after !== "number" ||
    Number.isNaN(after)
  ) {
    return null;
  }
  return t("Active context reduced: {before} -> {after}", {
    before: formatCount(before),
    after: formatCount(after),
  });
}

function getContextWindowDisplay(contextWindow: TraceContextWindow) {
  const after = contextWindow.approx_input_tokens_after_summary;
  const hasAfter = typeof after === "number" && !Number.isNaN(after);

  // After a compaction, the operator-facing "active" value is the reduced
  // context that will be carried forward. The pre-compaction estimate remains
  // visible as "Before" so the reduction can still be audited.
  return {
    activeTokens: hasAfter ? after : contextWindow.approx_input_tokens,
    activeRatio: hasAfter
      ? contextWindow.usage_ratio_after_summary
      : contextWindow.usage_ratio,
    hasAfter,
  };
}

export function TraceDetail({ trace, expanded = false }: TraceDetailProps) {
  if (!trace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t("Select a trace to view details")}
      </div>
    );
  }

  return (
    <TraceDetailContent
      key={trace.trace_id}
      trace={trace}
      expanded={expanded}
    />
  );
}

interface TraceDetailContentProps {
  trace: TraceItem;
  expanded: boolean;
}

function TraceDetailContent({
  trace,
  expanded,
}: TraceDetailContentProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [runFilter, setRunFilter] = useState<RunFilter>("core");
  const { data, isLoading } = useFetch<{ items: TraceEvent[] }>(
    trace ? `/api/admin/traces/${trace.trace_id}/events` : null,
  );
  const events = useMemo(() => data?.items ?? [], [data?.items]);
  const runs = useMemo(
    () => buildTraceRuns(events, trace.root_run_id),
    [events, trace.root_run_id],
  );
  const toolNames = useMemo(() => extractRegisteredToolNames(runs), [runs]);

  const visibleRuns = useMemo(
    () => (runFilter === "all" ? runs : runs.filter(isCoreTraceRun)),
    [runFilter, runs],
  );
  const hiddenRunCount = runs.length - visibleRuns.length;
  const reasoningRunCount = useMemo(
    () => visibleRuns.filter((run) => run.hasReasoning).length,
    [visibleRuns],
  );
  const truncatedRunCount = useMemo(
    () => visibleRuns.filter((run) => run.hasTruncatedPayload).length,
    [visibleRuns],
  );
  const latestContextWindow = useMemo(
    () => extractLatestContextWindow(runs) ?? trace.context_window ?? null,
    [runs, trace.context_window],
  );
  const latestContextDisplay = useMemo(
    () =>
      latestContextWindow
        ? getContextWindowDisplay(latestContextWindow)
        : null,
    [latestContextWindow],
  );
  const latestLLMSettings = useMemo(
    () => extractLatestLLMRequestSettings(runs),
    [runs],
  );
  const latestVisibleAnswer = useMemo(
    () => extractLatestVisibleAnswer(runs),
    [runs],
  );

  return (
    <ScrollArea className={expanded ? "h-[calc(100vh-13rem)]" : "h-[calc(100vh-16rem)]"}>
      <div className="space-y-4 p-4">
        {/* Meta info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge
              variant={
                trace.status === "completed"
                  ? "default"
                  : trace.status === "error"
                    ? "destructive"
                    : "secondary"
              }
            >
              {t(trace.status)}
            </Badge>
            <span className="text-sm font-medium">
              {trace.agent_name || t("Unknown Agent")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t("Trace ID:")}</span>{" "}
              <span className="font-mono text-xs">
                {trace.trace_id}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("Thread:")}</span>{" "}
              <span className="font-mono text-xs">
                {trace.thread_id || "-"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("Started:")}</span>{" "}
              {formatDate(trace.started_at)}
            </div>
            <div>
              <span className="text-muted-foreground">{t("Finished:")}</span>{" "}
              {formatDate(trace.finished_at)}
            </div>
            <div>
              <span className="text-muted-foreground">{t("Runs:")}</span> {runs.length}
            </div>
            <div>
              <span className="text-muted-foreground">{t("Raw Events:")}</span> {events.length}
            </div>
          </div>
          {latestLLMSettings && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("Latest LLM Request")}</p>
              <div className="flex flex-wrap gap-1.5">
                {latestLLMSettings.model && (
                  <Badge variant="outline" className="text-xs">
                    {t("Model")}: {latestLLMSettings.model}
                  </Badge>
                )}
                {latestLLMSettings.provider && (
                  <Badge variant="outline" className="text-xs">
                    {t("Provider")}: {latestLLMSettings.provider}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {t("Effort")}: {latestLLMSettings.effort ?? t("none")}
                </Badge>
                {latestLLMSettings.reasoningEffort && (
                  <Badge variant="outline" className="text-xs">
                    {t("Reasoning Effort")}: {latestLLMSettings.reasoningEffort}
                  </Badge>
                )}
                {latestLLMSettings.reasoning && (
                  <Badge variant="outline" className="text-xs">
                    {t("Reasoning Payload")}: {latestLLMSettings.reasoning}
                  </Badge>
                )}
                {latestLLMSettings.thinking && (
                  <Badge variant="outline" className="text-xs">
                    {t("Thinking Payload")}: {latestLLMSettings.thinking}
                  </Badge>
                )}
                {typeof latestLLMSettings.thinkingBudget === "number" && (
                  <Badge variant="outline" className="text-xs">
                    {t("Thinking Budget")}: {latestLLMSettings.thinkingBudget}
                  </Badge>
                )}
                {latestLLMSettings.thinkingLevel && (
                  <Badge variant="outline" className="text-xs">
                    {t("Thinking Level")}: {latestLLMSettings.thinkingLevel}
                  </Badge>
                )}
                {typeof latestLLMSettings.includeThoughts === "boolean" && (
                  <Badge variant="outline" className="text-xs">
                    {t("Include Thoughts")}: {latestLLMSettings.includeThoughts ? t("yes") : t("no")}
                  </Badge>
                )}
                {typeof latestLLMSettings.maxTokens === "number" && (
                  <Badge variant="outline" className="text-xs">
                    {t("Max Tokens")}: {latestLLMSettings.maxTokens}
                  </Badge>
                )}
                {typeof latestLLMSettings.temperature === "number" && (
                  <Badge variant="outline" className="text-xs">
                    {t("Temperature")}: {latestLLMSettings.temperature}
                  </Badge>
                )}
              </div>
            </div>
          )}
          {toolNames.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("Registered Tools")}</p>
              <div className="flex flex-wrap gap-1.5">
                {toolNames.map((toolName) => (
                  <Badge key={toolName} variant="outline" className="text-xs">
                    {toolName}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {trace.initial_user_message && (
            <div className="rounded-md bg-muted/50 p-2 text-sm">
              {trace.initial_user_message}
            </div>
          )}
          {latestVisibleAnswer && (
            <div className="rounded-md border bg-emerald-50/60 p-3 text-sm dark:bg-emerald-950/20">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Final Answer")}
              </p>
              <p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-foreground">
                {latestVisibleAnswer}
              </p>
            </div>
          )}
          {trace.error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-2 text-sm text-red-700 dark:text-red-300">
              {trace.error}
            </div>
          )}
        </div>

        <TokenSummary trace={trace} />

        {latestContextWindow && latestContextDisplay && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm font-medium">
              <span>{t("Context Window")}</span>
              {latestContextWindow.summary_applied && (
                <Badge variant="outline">{t("Compacted")}</Badge>
              )}
            </div>
            {typeof latestContextDisplay.activeRatio === "number" && (
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        (latestContextDisplay.activeRatio ?? 0) * 100,
                      ),
                    )}%`,
                  }}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {latestContextWindow.max_input_tokens
                  ? t("Active: {used} / {max}", {
                      used: formatCount(latestContextDisplay.activeTokens),
                      max: formatCount(latestContextWindow.max_input_tokens),
                    })
                  : t("Active: {used}", {
                      used: formatCount(latestContextDisplay.activeTokens),
                    })}
              </span>
              {latestContextDisplay.hasAfter && (
                <span>
                  {latestContextWindow.max_input_tokens
                    ? t("Before: {used} / {max}", {
                        used: formatCount(latestContextWindow.approx_input_tokens),
                        max: formatCount(latestContextWindow.max_input_tokens),
                      })
                    : t("Before: {used}", {
                        used: formatCount(latestContextWindow.approx_input_tokens),
                      })}
                </span>
              )}
              {formatPercent(latestContextWindow.usage_ratio) && (
                <span>
                  {latestContextDisplay.hasAfter
                    ? t("Before compaction: {ratio}", {
                        ratio: formatPercent(latestContextWindow.usage_ratio),
                      })
                    : t("{ratio} used", {
                        ratio: formatPercent(latestContextWindow.usage_ratio),
                      })}
                </span>
              )}
              {formatPercent(latestContextWindow.usage_ratio_after_summary) && (
                <span>
                  {t("After compaction: {ratio}", {
                    ratio: formatPercent(latestContextWindow.usage_ratio_after_summary),
                  })}
                </span>
              )}
              {typeof latestContextWindow.summary_count === "number" && (
                <span>
                  {t("{count} summaries", {
                    count: latestContextWindow.summary_count,
                  })}
                </span>
              )}
            </div>
            {formatCompactionReduction(latestContextWindow) && (
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                {formatCompactionReduction(latestContextWindow)}
              </p>
            )}
            {latestContextWindow.last_summary?.summary_preview && (
              <details className="rounded-md border bg-muted/30 px-3 py-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t("Raw compact summary preview")}
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {latestContextWindow.last_summary.summary_preview}
                </p>
              </details>
            )}
          </div>
        )}

        <Separator />

        {/* Event tree */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-medium">{t("Events")}</h4>
            <div className="flex items-center gap-2">
              <Button
                variant={runFilter === "core" ? "default" : "outline"}
                size="sm"
                onClick={() => setRunFilter("core")}
              >
                {t("Core")}
              </Button>
              <Button
                variant={runFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setRunFilter("all")}
              >
                {t("All")}
              </Button>
              <Button
                variant={viewMode === "timeline" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("timeline")}
              >
                {t("Timeline")}
              </Button>
              <Button
                variant={viewMode === "galaxy" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("galaxy")}
              >
                {t("Galaxy 3D")}
              </Button>
            </div>
          </div>
          {runFilter === "core" && hiddenRunCount > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              {t(
                "Hidden {count} noisy wrapper runs. Switch to `All` if you need the full raw chain.",
                { count: hiddenRunCount },
              )}
            </p>
          )}
          {(reasoningRunCount > 0 || truncatedRunCount > 0) && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {reasoningRunCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-300 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300"
                >
                  {t(
                    reasoningRunCount > 1
                      ? "{count} runs with reasoning"
                      : "{count} run with reasoning",
                    { count: reasoningRunCount },
                  )}
                </Badge>
              )}
              {truncatedRunCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-300 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300"
                >
                  {t(
                    truncatedRunCount > 1
                      ? "{count} backend-truncated runs"
                      : "{count} backend-truncated run",
                    { count: truncatedRunCount },
                  )}
                </Badge>
              )}
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : viewMode === "galaxy" ? (
            <Suspense
              fallback={
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              }
            >
              <GalaxyTraceView
                runs={visibleRuns}
                allRuns={runs}
                rootRunId={trace.root_run_id}
              />
            </Suspense>
          ) : (
            <EventTree runs={visibleRuns} allRuns={runs} />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
