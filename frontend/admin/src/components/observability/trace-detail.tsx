import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatDate, maskString } from "@/lib/format";
import { EventTree } from "./event-tree";
import { TokenSummary } from "./token-summary";
import { useFetch } from "@/hooks/use-fetch";
import type { TraceItem, TraceEvent } from "@/types";

interface TraceDetailProps {
  trace: TraceItem | null;
}

export function TraceDetail({ trace }: TraceDetailProps) {
  const { data, isLoading } = useFetch<{ items: TraceEvent[] }>(
    trace ? `/api/admin/traces/${trace.trace_id}/events` : null,
  );

  if (!trace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a trace to view details
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-16rem)]">
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
          </div>
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
          <h4 className="text-sm font-medium mb-2">Events</h4>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <EventTree events={data?.items ?? []} />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
