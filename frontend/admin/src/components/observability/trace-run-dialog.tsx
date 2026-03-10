import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatAgo, formatDateTime, maskString } from "@/lib/format";
import { JsonMarkdownInspector } from "./json-markdown-inspector";
import {
  extractRunSections,
  isMiddlewareRun,
  type TraceRunSummary,
} from "./trace-run-utils";

interface TraceRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: TraceRunSummary | null;
}

function metaValue(value: number | string | undefined | null): string {
  if (value == null || value === "") return "-";
  return String(value);
}

export function TraceRunDialog({
  open,
  onOpenChange,
  run,
}: TraceRunDialogProps) {
  if (!run) {
    return null;
  }

  const sections = extractRunSections(run);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl h-[88vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{run.runType}</Badge>
            <Badge
              variant={
                run.status === "error"
                  ? "destructive"
                  : run.status === "completed"
                    ? "default"
                    : "secondary"
              }
            >
              {run.status}
            </Badge>
            {isMiddlewareRun(run) && <Badge variant="secondary">middleware</Badge>}
            {run.taskRunId && <Badge variant="outline">sub-agent</Badge>}
          </div>
          <DialogTitle>{run.label}</DialogTitle>
          <DialogDescription>{run.summary || "Run details"}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-full">
          <div className="space-y-4 px-6 py-4">
            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
              <div>
                Run ID: <span className="font-mono">{maskString(run.runId, 8, 6)}</span>
              </div>
              <div>
                Parent:{" "}
                <span className="font-mono">
                  {run.parentRunId ? maskString(run.parentRunId, 8, 6) : "-"}
                </span>
              </div>
              <div>Events: {run.eventCount}</div>
              <div>Started: {formatDateTime(run.startedAt)}</div>
              <div>Finished: {formatDateTime(run.finishedAt)}</div>
              <div>
                Relative: {run.startedAt ? formatAgo(run.startedAt) : "-"}
              </div>
              <div>
                Duration:{" "}
                {metaValue(run.durationMs != null ? `${run.durationMs}ms` : null)}
              </div>
              <div>Input Tokens: {metaValue(run.inputTokens)}</div>
              <div>Output Tokens: {metaValue(run.outputTokens)}</div>
              <div>Total Tokens: {metaValue(run.totalTokens)}</div>
              <div>Node: {run.nodeName ?? "-"}</div>
              <div>Tool: {run.toolName ?? "-"}</div>
            </div>

            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payload details captured.</p>
            ) : (
              <div className="space-y-4">
                {sections.map((section) => (
                  <div key={section.key} className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {section.title}
                    </p>
                    <JsonMarkdownInspector value={section.value} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
