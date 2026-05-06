import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatAgo, formatDateTime } from "@/lib/format";
import type { TraceItem } from "@/types";

interface TraceListProps {
  traces: TraceItem[] | null;
  isLoading: boolean;
  selectedIds: Set<string>;
  onSelect: (trace: TraceItem) => void;
  onToggleSelect: (traceId: string, selected: boolean) => void;
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

function formatCompactCount(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return null;
  }
  return t("Compacted x{count}", { count: value });
}

function formatContextTokens(trace: TraceItem) {
  const contextWindow = trace.context_window;
  if (!contextWindow) return null;
  const active =
    contextWindow.approx_input_tokens_after_summary ??
    contextWindow.approx_input_tokens;
  if (typeof active !== "number" || Number.isNaN(active)) return null;
  const max = contextWindow.max_input_tokens;
  const activeLabel = new Intl.NumberFormat().format(Math.round(active));
  if (typeof max === "number" && !Number.isNaN(max)) {
    return t("Active context {used}/{max}", {
      used: activeLabel,
      max: new Intl.NumberFormat().format(Math.round(max)),
    });
  }
  return t("Active context {used}", { used: activeLabel });
}

export function TraceList({
  traces,
  isLoading,
  selectedIds,
  onSelect,
  onToggleSelect,
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
        <p>{t("No traces found")}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-2">
        {traces.map((trace) => {
          const compactLabel = formatCompactCount(
            trace.context_window?.summary_count,
          );
          const isSelectedForDelete = selectedIds.has(trace.trace_id);

          return (
            <div
              key={trace.trace_id}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent",
                isSelectedForDelete && "border-primary/70 bg-accent/50",
              )}
            >
              <input
                type="checkbox"
                aria-label={t("Select trace")}
                checked={isSelectedForDelete}
                onChange={(event) =>
                  onToggleSelect(trace.trace_id, event.target.checked)
                }
                className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <button
                type="button"
                onClick={() => onSelect(trace)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        statusColor(trace.status),
                      )}
                    />
                    <span className="truncate text-sm font-medium">
                      {trace.agent_name || t("Unknown Agent")}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {compactLabel && (
                      <Badge variant="secondary" className="text-xs">
                        {compactLabel}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {t("Provider {count} tok", { count: trace.total_tokens })}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-foreground/85 line-clamp-2">
                  {trace.initial_user_message || t("No user message preview")}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate max-w-[120px]">
                    {trace.thread_id || t("no thread")}
                  </span>
                  <span className="truncate">
                    {formatDateTime(trace.started_at)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {trace.model_name || t("unknown model")}
                  </span>
                  <span className="truncate text-right">
                    {formatContextTokens(trace) || formatAgo(trace.started_at)}
                  </span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
