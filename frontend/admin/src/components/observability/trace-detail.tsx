import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatDate, maskString } from "@/lib/format";
import { EventTree } from "./event-tree";
import { TokenSummary } from "./token-summary";
import { useFetch } from "@/hooks/use-fetch";
import type { TraceItem, TraceEvent } from "@/types";
import { buildTraceRuns, isCoreTraceRun } from "./trace-run-utils";

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

export function TraceDetail({ trace, expanded = false }: TraceDetailProps) {
  if (!trace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a trace to view details
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
  const toolNames = useMemo(() => {
    const rawToolNames = trace.metadata?.tool_names;
    if (!Array.isArray(rawToolNames)) return [];
    return rawToolNames.filter((item): item is string => typeof item === "string");
  }, [trace.metadata]);

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
              {trace.status}
            </Badge>
            <span className="text-sm font-medium">
              {trace.agent_name || "Unknown Agent"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Trace ID:</span>{" "}
              <span className="font-mono text-xs">
                {maskString(trace.trace_id, 8, 4)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Thread:</span>{" "}
              <span className="font-mono text-xs">
                {trace.thread_id
                  ? maskString(trace.thread_id, 8, 4)
                  : "-"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Started:</span>{" "}
              {formatDate(trace.started_at)}
            </div>
            <div>
              <span className="text-muted-foreground">Finished:</span>{" "}
              {formatDate(trace.finished_at)}
            </div>
            <div>
              <span className="text-muted-foreground">Runs:</span> {runs.length}
            </div>
            <div>
              <span className="text-muted-foreground">Raw Events:</span> {events.length}
            </div>
          </div>
          {toolNames.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Registered Tools</p>
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
          {trace.error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-2 text-sm text-red-700 dark:text-red-300">
              {trace.error}
            </div>
          )}
        </div>

        <TokenSummary trace={trace} />

        <Separator />

        {/* Event tree */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-medium">Events</h4>
            <div className="flex items-center gap-2">
              <Button
                variant={runFilter === "core" ? "default" : "outline"}
                size="sm"
                onClick={() => setRunFilter("core")}
              >
                Core
              </Button>
              <Button
                variant={runFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setRunFilter("all")}
              >
                All
              </Button>
              <Button
                variant={viewMode === "timeline" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("timeline")}
              >
                Timeline
              </Button>
              <Button
                variant={viewMode === "galaxy" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("galaxy")}
              >
                Galaxy 3D
              </Button>
            </div>
          </div>
          {runFilter === "core" && hiddenRunCount > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              Hidden {hiddenRunCount} noisy wrapper runs. Switch to `All` if you
              need the full raw chain.
            </p>
          )}
          {(reasoningRunCount > 0 || truncatedRunCount > 0) && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {reasoningRunCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-300 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300"
                >
                  {reasoningRunCount} run{reasoningRunCount > 1 ? "s" : ""} with reasoning
                </Badge>
              )}
              {truncatedRunCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-300 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-300"
                >
                  {truncatedRunCount} backend-truncated run
                  {truncatedRunCount > 1 ? "s" : ""}
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
                rootRunId={trace.root_run_id}
              />
            </Suspense>
          ) : (
            <EventTree runs={visibleRuns} />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
