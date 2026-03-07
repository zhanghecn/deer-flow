import { Bot, ChevronRight, Hammer, Link2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/lib/format";
import type { TraceEvent } from "@/types";

interface EventTreeProps {
  events: TraceEvent[];
}

function runTypeIcon(runType: string) {
  switch (runType) {
    case "llm":
      return <Bot className="h-3.5 w-3.5 text-purple-500" />;
    case "tool":
      return <Hammer className="h-3.5 w-3.5 text-amber-500" />;
    case "chain":
      return <Link2 className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <Workflow className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function computeDepths(events: TraceEvent[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const runIdDepth = new Map<string, number>();

  for (const evt of events) {
    if (!runIdDepth.has(evt.run_id)) {
      const parentDepth = evt.parent_run_id
        ? (runIdDepth.get(evt.parent_run_id) ?? 0)
        : 0;
      const depth = evt.parent_run_id ? parentDepth + 1 : 0;
      runIdDepth.set(evt.run_id, depth);
    }
    depthMap.set(`${evt.id}`, runIdDepth.get(evt.run_id) ?? 0);
  }

  return depthMap;
}

export function EventTree({ events }: EventTreeProps) {
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No events
      </p>
    );
  }

  const depths = computeDepths(events);

  return (
    <div className="space-y-0.5">
      {events.map((evt) => {
        const depth = depths.get(`${evt.id}`) ?? 0;
        const isError = evt.status === "error";

        return (
          <div
            key={evt.id}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors",
              isError && "bg-red-50 dark:bg-red-950/30",
            )}
            style={{ paddingLeft: `${depth * 20 + 8}px` }}
          >
            {depth > 0 && (
              <ChevronRight className="h-3 w-3 mt-1 text-muted-foreground/50 shrink-0" />
            )}
            <div className="mt-0.5 shrink-0">{runTypeIcon(evt.run_type)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {evt.run_type}
                </Badge>
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {evt.event_type}
                </Badge>
                {evt.node_name && (
                  <span className="text-xs font-medium">{evt.node_name}</span>
                )}
                {evt.tool_name && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0 border-amber-300 text-amber-700 dark:text-amber-300"
                  >
                    {evt.tool_name}
                  </Badge>
                )}
                {evt.task_run_id && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0 border-purple-300 text-purple-700 dark:text-purple-300"
                  >
                    sub-agent
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                {(evt.total_tokens != null && evt.total_tokens > 0) && (
                  <span className="tabular-nums">
                    {evt.input_tokens ?? 0}↓ {evt.output_tokens ?? 0}↑
                  </span>
                )}
                {evt.duration_ms != null && (
                  <span className="tabular-nums">{evt.duration_ms}ms</span>
                )}
                {evt.started_at && <span>{formatAgo(evt.started_at)}</span>}
              </div>
              {evt.error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 break-all">
                  {evt.error}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
