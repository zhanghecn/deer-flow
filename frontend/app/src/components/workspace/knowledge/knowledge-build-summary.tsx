import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  LoaderIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/core/i18n/hooks";
import {
  getKnowledgeDocumentProgress,
  getKnowledgeDocumentStatus,
  isKnowledgeDocumentBuildActive,
} from "@/core/knowledge/documents";
import type { KnowledgeBase, KnowledgeDocument } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

export type KnowledgeBuildSummary = {
  total: number;
  ready: number;
  queued: number;
  processing: number;
  error: number;
  active: number;
  progress: number;
  activeDocumentName?: string;
};

export function summarizeKnowledgeDocuments(
  documents: KnowledgeDocument[],
): KnowledgeBuildSummary {
  // Keep every knowledge surface on the same status math so management,
  // attachment strips, and agent binding lists do not drift visually.
  const summary: KnowledgeBuildSummary = {
    total: documents.length,
    ready: 0,
    queued: 0,
    processing: 0,
    error: 0,
    active: 0,
    progress: 0,
  };

  let progressTotal = 0;
  for (const document of documents) {
    const status = getKnowledgeDocumentStatus(document);
    const progress = getKnowledgeDocumentProgress(document);
    progressTotal += progress;

    if (status === "ready") {
      summary.ready += 1;
    } else if (status === "queued") {
      summary.queued += 1;
    } else if (status === "processing") {
      summary.processing += 1;
    } else if (status === "error") {
      summary.error += 1;
    }

    if (isKnowledgeDocumentBuildActive(document)) {
      summary.active += 1;
      summary.activeDocumentName ??= document.display_name;
    }
  }

  summary.progress =
    documents.length > 0 ? Math.round(progressTotal / documents.length) : 0;
  return summary;
}

export function summarizeKnowledgeBase(
  knowledgeBase: KnowledgeBase,
): KnowledgeBuildSummary {
  return summarizeKnowledgeDocuments(knowledgeBase.documents);
}

function buildSummaryTone(summary: KnowledgeBuildSummary) {
  if (summary.error > 0) {
    return {
      icon: AlertCircleIcon,
      className: "text-red-600 dark:text-red-400",
      variant: "destructive" as const,
    };
  }
  if (summary.active > 0 || summary.queued > 0) {
    return {
      icon: LoaderIcon,
      className: "text-amber-600 dark:text-amber-400",
      variant: "secondary" as const,
    };
  }
  if (summary.total > 0 && summary.ready === summary.total) {
    return {
      icon: CheckCircle2Icon,
      className: "text-emerald-600 dark:text-emerald-400",
      variant: "default" as const,
    };
  }
  return {
    icon: ClockIcon,
    className: "text-muted-foreground",
    variant: "outline" as const,
  };
}

export function KnowledgeBaseBuildSummary({
  documents,
  compact = false,
  className,
}: {
  documents: KnowledgeDocument[];
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const summary = summarizeKnowledgeDocuments(documents);
  const tone = buildSummaryTone(summary);
  const Icon = tone.icon;
  const currentLabel =
    summary.activeDocumentName ??
    (summary.error > 0
      ? t.knowledge.buildSummaryNeedsAttention
      : t.knowledge.buildSummaryReady);

  if (compact) {
    return (
      <div
        className={cn(
          "border-border bg-background flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5",
          className,
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", tone.className)} />
        <div className="min-w-0 text-xs font-medium">
          {t.knowledge.buildSummaryTitle}
        </div>
        <Progress value={summary.progress} className="h-1 min-w-16 flex-1" />
        <Badge variant={tone.variant} className="h-5 px-1.5 text-[11px]">
          {t.knowledge.buildSummaryProgress(summary.progress)}
        </Badge>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-border bg-background flex min-w-0 flex-col gap-3 rounded-lg border px-3 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className={cn("mt-0.5 size-4 shrink-0", tone.className)} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {t.knowledge.buildSummaryTitle}
            </div>
            {!compact ? (
              <div className="text-muted-foreground mt-1 truncate text-xs">
                {currentLabel}
              </div>
            ) : null}
          </div>
        </div>
        <Badge variant={tone.variant}>
          {t.knowledge.buildSummaryProgress(summary.progress)}
        </Badge>
      </div>
      <Progress value={summary.progress} className="h-1.5" />
      {!compact ? (
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{t.knowledge.readyCount(summary.ready)}</span>
          {summary.processing > 0 ? (
            <span>{t.knowledge.processingCount(summary.processing)}</span>
          ) : null}
          {summary.queued > 0 ? (
            <span>{t.knowledge.queuedCount(summary.queued)}</span>
          ) : null}
          {summary.error > 0 ? (
            <span className="text-red-600 dark:text-red-400">
              {t.knowledge.errorCount(summary.error)}
            </span>
          ) : null}
          <span>{t.knowledge.documentCount(summary.total)}</span>
        </div>
      ) : null}
    </div>
  );
}
