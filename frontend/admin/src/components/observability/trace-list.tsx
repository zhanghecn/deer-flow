import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatAgo, maskString } from "@/lib/format";
import type { TraceItem } from "@/types";

interface TraceListProps {
  traces: TraceItem[] | null;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function statusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-yellow-500 animate-pulse";
  }
}

export function TraceList({
  traces,
  isLoading,
  selectedId,
  onSelect,
}: TraceListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!traces?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Activity className="h-12 w-12 mb-2 opacity-40" />
        <p>No traces found</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-16rem)]">
      <div className="space-y-1 p-2">
        {traces.map((trace) => (
          <button
            key={trace.trace_id}
            onClick={() => onSelect(trace.trace_id)}
            className={cn(
              "w-full text-left rounded-md border p-3 transition-colors hover:bg-accent",
              selectedId === trace.trace_id && "bg-accent border-primary",
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn("h-2 w-2 rounded-full", statusColor(trace.status))}
                />
                <span className="font-medium text-sm truncate max-w-[140px]">
                  {trace.agent_name || "Unknown Agent"}
                </span>
              </div>
              <Badge variant="outline" className="text-xs">
                {trace.total_tokens} tok
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[120px]">
                {trace.thread_id
                  ? maskString(trace.thread_id, 6, 4)
                  : "no thread"}
              </span>
              <span>{formatAgo(trace.started_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
