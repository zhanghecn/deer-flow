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
import { cn } from "@/lib/utils";
import { JsonMarkdownInspector } from "./json-markdown-inspector";
import {
  extractRunSections,
  isMiddlewareRun,
  type TraceRunSummary,
} from "./trace-run-utils";
import { t } from "@/i18n";

interface TraceRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: TraceRunSummary | null;
}

function metaValue(value: number | string | undefined | null): string {
  if (value == null || value === "") return "-";
  return String(value);
}

function sectionKindLabel(kind: ReturnType<typeof extractRunSections>[number]["kind"]) {
  switch (kind) {
    case "reasoning":
      return t("Reasoning");
    case "messages":
      return t("Messages");
    case "tools":
      return t("Tool Payload");
    case "config":
      return t("Config");
    case "metadata":
      return t("Metadata");
    case "state":
    default:
      return t("State");
  }
}

function sectionChrome(kind: ReturnType<typeof extractRunSections>[number]["kind"]) {
  switch (kind) {
    case "reasoning":
      return "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20";
    case "messages":
      return "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20";
    case "tools":
      return "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20";
    case "config":
      return "border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20";
    case "metadata":
      return "border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/30";
    case "state":
    default:
      return "border-zinc-200 bg-background dark:border-zinc-800";
  }
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
  const truncatedSectionCount = sections.filter((section) => section.truncated).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl h-[88vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t(run.runType)}</Badge>
            <Badge
              variant={
                run.status === "error"
                  ? "destructive"
                : run.status === "completed"
                    ? "default"
                    : "secondary"
              }
            >
              {t(run.status)}
            </Badge>
            {isMiddlewareRun(run) && <Badge variant="secondary">{t("middleware")}</Badge>}
            {run.taskRunId && <Badge variant="outline">{t("sub-agent")}</Badge>}
          </div>
          <DialogTitle>{run.label}</DialogTitle>
          <DialogDescription>{run.summary || t("Run details")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-full">
          <div className="space-y-4 px-6 py-4">
            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
              <div>
                {t("Run ID:")} <span className="font-mono">{maskString(run.runId, 8, 6)}</span>
              </div>
              <div>
                {t("Parent:")}{" "}
                <span className="font-mono">
                  {run.parentRunId ? maskString(run.parentRunId, 8, 6) : "-"}
                </span>
              </div>
              <div>{t("Events")}: {run.eventCount}</div>
              <div>{t("Started:")} {formatDateTime(run.startedAt)}</div>
              <div>{t("Finished:")} {formatDateTime(run.finishedAt)}</div>
              <div>
                {t("Relative:")} {run.startedAt ? formatAgo(run.startedAt) : "-"}
              </div>
              <div>
                {t("Duration:")}{" "}
                {metaValue(run.durationMs != null ? `${run.durationMs}ms` : null)}
              </div>
              <div>{t("Input Tokens:")} {metaValue(run.inputTokens)}</div>
              <div>{t("Output Tokens:")} {metaValue(run.outputTokens)}</div>
              <div>{t("Total Tokens:")} {metaValue(run.totalTokens)}</div>
              <div>{t("Node:")} {run.nodeName ?? "-"}</div>
              <div>{t("Tool:")} {run.toolName ?? "-"}</div>
            </div>

            {truncatedSectionCount > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                {t(
                  truncatedSectionCount > 1
                    ? "{count} sections contain payloads truncated during backend trace capture before persistence. This is not just a page display cutoff."
                    : "{count} section contains payloads truncated during backend trace capture before persistence. This is not just a page display cutoff.",
                  { count: truncatedSectionCount },
                )}
              </div>
            )}

            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No payload details captured.")}</p>
            ) : (
              <div className="space-y-4">
                {sections.map((section) => (
                  <details
                    key={section.key}
                    open={section.kind !== "metadata"}
                    className={cn(
                      "rounded-xl border px-4 py-4",
                      sectionChrome(section.kind),
                    )}
                  >
                    <summary className="cursor-pointer list-none space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[11px]">
                          {sectionKindLabel(section.kind)}
                        </Badge>
                        {section.truncated && (
                          <Badge
                            variant="outline"
                            className="border-amber-300 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-300"
                          >
                            {t("trace truncated")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium">{section.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {section.description}
                      </p>
                    </summary>
                    <div className="space-y-3 pt-3">
                      <JsonMarkdownInspector value={section.value} />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
