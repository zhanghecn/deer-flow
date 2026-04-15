import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatAgo, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JsonMarkdownInspector } from "./json-markdown-inspector";
import {
  collectTaskSessionRuns,
  extractRunSections,
  getTaskSessionId,
  isMiddlewareRun,
  type TraceRunSummary,
} from "./trace-run-utils";
import { t } from "@/i18n";

interface TraceRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: TraceRunSummary | null;
  runs?: TraceRunSummary[];
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
  runs = [],
}: TraceRunDialogProps) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const dialogRuns = useMemo(
    () => (runs.length > 0 ? runs : run ? [run] : []),
    [run, runs],
  );

  const defaultActiveRunId = useMemo(() => {
    if (!run) {
      return null;
    }

    const taskSessionRuns = collectTaskSessionRuns(run, dialogRuns);
    const taskSessionId = getTaskSessionId(run);
    if (taskSessionId && run.runId === taskSessionId) {
      const firstInternalRun = taskSessionRuns.find(
        (candidate) => candidate.runId !== taskSessionId,
      );
      return firstInternalRun?.runId ?? run.runId;
    }

    return run.runId;
  }, [dialogRuns, run]);

  useEffect(() => {
    setActiveRunId(defaultActiveRunId);
  }, [defaultActiveRunId]);

  if (!run) {
    return null;
  }

  const activeRun =
    dialogRuns.find((candidate) => candidate.runId === activeRunId) ?? run;
  const taskSessionRuns = collectTaskSessionRuns(run, dialogRuns);
  const taskSessionId = getTaskSessionId(run);
  const sections = extractRunSections(activeRun);
  const truncatedSectionCount = sections.filter((section) => section.truncated).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl h-[88vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t(activeRun.runType)}</Badge>
            <Badge
              variant={
                activeRun.status === "error"
                  ? "destructive"
                : activeRun.status === "completed"
                    ? "default"
                    : "secondary"
              }
            >
              {t(activeRun.status)}
            </Badge>
            {isMiddlewareRun(activeRun) && <Badge variant="secondary">{t("middleware")}</Badge>}
            {getTaskSessionId(activeRun) && <Badge variant="outline">{t("sub-agent")}</Badge>}
          </div>
          <DialogTitle>{activeRun.label}</DialogTitle>
          <DialogDescription>{activeRun.summary || t("Run details")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-full">
          <div className="space-y-4 px-6 py-4">
            {taskSessionRuns.length > 1 && (
              <div className="rounded-xl border border-cyan-200/70 bg-cyan-50/40 px-4 py-4 dark:border-cyan-900 dark:bg-cyan-950/20">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t("Sub-agent Session")}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {t("{count} internal runs grouped by one task session.", {
                      count: taskSessionRuns.length,
                    })}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("Task Session ID:")}{" "}
                  <span className="font-mono">{taskSessionId || "-"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {taskSessionRuns.map((sessionRun) => {
                    const selected = sessionRun.runId === activeRun.runId;
                    return (
                      <button
                        key={sessionRun.runId}
                        type="button"
                        onClick={() => setActiveRunId(sessionRun.runId)}
                        className={cn(
                          "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                          selected
                            ? "border-cyan-400 bg-cyan-100/80 text-cyan-950 dark:border-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-50"
                            : "border-border bg-background hover:bg-accent/40",
                        )}
                      >
                        <div className="font-medium">{sessionRun.label}</div>
                        <div className="mt-1 max-w-[24rem] text-muted-foreground">
                          {sessionRun.summary || t("Run details")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
              <div>
                {t("Run ID:")} <span className="font-mono">{activeRun.runId}</span>
              </div>
              <div>
                {t("Parent:")}{" "}
                <span className="font-mono">
                  {activeRun.parentRunId || "-"}
                </span>
              </div>
              <div>{t("Events")}: {activeRun.eventCount}</div>
              <div>{t("Started:")} {formatDateTime(activeRun.startedAt)}</div>
              <div>{t("Finished:")} {formatDateTime(activeRun.finishedAt)}</div>
              <div>
                {t("Relative:")} {activeRun.startedAt ? formatAgo(activeRun.startedAt) : "-"}
              </div>
              <div>
                {t("Duration:")}{" "}
                {metaValue(activeRun.durationMs != null ? `${activeRun.durationMs}ms` : null)}
              </div>
              <div>{t("Input Tokens:")} {metaValue(activeRun.inputTokens)}</div>
              <div>{t("Output Tokens:")} {metaValue(activeRun.outputTokens)}</div>
              <div>{t("Total Tokens:")} {metaValue(activeRun.totalTokens)}</div>
              <div>{t("Node:")} {activeRun.nodeName ?? "-"}</div>
              <div>{t("Tool:")} {activeRun.toolName ?? "-"}</div>
              <div>{t("Agent Mode:")} {activeRun.effectiveAgentMode ?? "-"}</div>
              <div>{t("Agent Name:")} {activeRun.effectiveAgentName ?? "-"}</div>
              <div>{t("Expected Output:")} {activeRun.expectedReturnShape ?? "-"}</div>
              <div>{t("Mutation Scope:")} {activeRun.mutationScope ?? "-"}</div>
              <div>{t("Launch Failure:")} {activeRun.launchFailureClass ?? "-"}</div>
              <div>{t("Execution Backend:")} {activeRun.executionBackend ?? "-"}</div>
              <div>{t("Requested Timeout:")} {metaValue(activeRun.requestedTimeoutSeconds != null ? `${activeRun.requestedTimeoutSeconds}s` : null)}</div>
              <div>{t("Default Timeout:")} {metaValue(activeRun.defaultTimeoutSeconds != null ? `${activeRun.defaultTimeoutSeconds}s` : null)}</div>
              <div>{t("Max Timeout:")} {metaValue(activeRun.maxTimeoutSeconds != null ? `${activeRun.maxTimeoutSeconds}s` : null)}</div>
              <div>{t("Anomalies:")} {activeRun.anomalyFlags.length > 0 ? activeRun.anomalyFlags.join(", ") : "-"}</div>
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
