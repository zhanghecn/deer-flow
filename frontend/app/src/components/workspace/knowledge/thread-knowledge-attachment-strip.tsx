import { useQueryClient } from "@tanstack/react-query";
import { BookOpenTextIcon, LoaderIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/core/i18n/hooks";
import { detachKnowledgeBaseFromThread } from "@/core/knowledge/api";
import {
  getKnowledgeDocumentProgress,
  getKnowledgeDocumentStatus,
  isKnowledgeDocumentBuildActive,
} from "@/core/knowledge/documents";
import { useThreadKnowledgeBases } from "@/core/knowledge/hooks";
import type { KnowledgeBase } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

type AttachedKnowledgeSummary = {
  status: string;
  progress: number;
  documentCount: number;
  activeDocumentName?: string;
};

function knowledgeStatusLabel(
  status: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (status) {
    case "queued":
      return t.knowledge.status.queued;
    case "processing":
      return t.knowledge.status.processing;
    case "error":
      return t.knowledge.status.error;
    default:
      return t.knowledge.status.ready;
  }
}

function knowledgeStatusClassName(status: string) {
  switch (status) {
    case "processing":
    case "queued":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "error":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
    default:
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
}

function summarizeAttachedKnowledgeBase(
  knowledgeBase: KnowledgeBase,
): AttachedKnowledgeSummary {
  const activeDocuments = knowledgeBase.documents.filter((document) =>
    isKnowledgeDocumentBuildActive(document),
  );
  const errorDocuments = knowledgeBase.documents.filter(
    (document) => getKnowledgeDocumentStatus(document) === "error",
  );
  const readyDocuments = knowledgeBase.documents.filter(
    (document) => getKnowledgeDocumentStatus(document) === "ready",
  );
  const activeDocument = activeDocuments[0];

  if (activeDocument) {
    const totalProgress = activeDocuments.reduce(
      (sum, document) => sum + getKnowledgeDocumentProgress(document),
      0,
    );
    return {
      status: getKnowledgeDocumentStatus(activeDocument),
      progress: Math.round(totalProgress / activeDocuments.length),
      documentCount: knowledgeBase.documents.length,
      activeDocumentName: activeDocument.display_name,
    };
  }

  if (errorDocuments.length > 0) {
    return {
      status: "error",
      progress: 0,
      documentCount: knowledgeBase.documents.length,
      activeDocumentName:
        knowledgeBase.documents.length === 1
          ? errorDocuments[0]?.display_name
          : undefined,
    };
  }

  return {
    status: "ready",
    progress:
      readyDocuments.length === knowledgeBase.documents.length ? 100 : 0,
    documentCount: knowledgeBase.documents.length,
    activeDocumentName:
      knowledgeBase.documents.length === 1
        ? readyDocuments[0]?.display_name
        : undefined,
  };
}

export function ThreadKnowledgeAttachmentStrip({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { knowledgeBases, isLoading } = useThreadKnowledgeBases(threadId);
  const [busyBaseId, setBusyBaseId] = useState<string | null>(null);

  const handleDetach = useCallback(
    async (knowledgeBase: KnowledgeBase) => {
      setBusyBaseId(knowledgeBase.id);
      try {
        // Thread bindings are the only chat-facing source of truth, so detach
        // edits the persisted binding directly instead of mutating local UI
        // state that would be lost on refresh.
        await detachKnowledgeBaseFromThread(threadId, knowledgeBase.id);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["thread-knowledge-bases", threadId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["knowledge-library", threadId],
          }),
        ]);
        toast.success(t.knowledge.detachedSuccess(knowledgeBase.name));
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t.knowledge.bindingError,
        );
      } finally {
        setBusyBaseId(null);
      }
    },
    [queryClient, t, threadId],
  );

  if (!isLoading && knowledgeBases.length === 0) {
    return null;
  }

  return (
    <div className={cn("border-border/60 border-t px-3 py-2", className)}>
      <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
        {isLoading && knowledgeBases.length === 0 ? (
          <LoaderIcon className="size-3.5 animate-spin" />
        ) : (
          <BookOpenTextIcon className="size-3.5" />
        )}
        <span>
          {isLoading && knowledgeBases.length === 0
            ? t.knowledge.loadingAttached
            : t.knowledge.attachedBaseCount(knowledgeBases.length)}
        </span>
      </div>

      {knowledgeBases.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {knowledgeBases.map((knowledgeBase) => {
            const summary = summarizeAttachedKnowledgeBase(knowledgeBase);
            const isBusy = busyBaseId === knowledgeBase.id;

            return (
              <div
                key={knowledgeBase.id}
                className="border-border/60 bg-background/70 min-w-[220px] flex-1 rounded-2xl border px-3 py-2"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <div className="bg-primary/10 text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-2xl">
                    <BookOpenTextIcon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-xs font-medium">
                        {knowledgeBase.name}
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                          knowledgeStatusClassName(summary.status),
                        )}
                      >
                        {summary.status === "processing"
                          ? `${knowledgeStatusLabel(summary.status, t)} ${summary.progress}%`
                          : knowledgeStatusLabel(summary.status, t)}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                      <span>
                        {t.knowledge.documentCount(summary.documentCount)}
                      </span>
                      {summary.activeDocumentName ? (
                        <>
                          <span>·</span>
                          <span className="max-w-[16rem] truncate">
                            {summary.activeDocumentName}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={isBusy}
                    onClick={() => void handleDetach(knowledgeBase)}
                  >
                    {isBusy ? (
                      <LoaderIcon className="mr-2 size-3.5 animate-spin" />
                    ) : null}
                    {t.knowledge.detach}
                  </Button>
                </div>

                {summary.status === "queued" ||
                summary.status === "processing" ? (
                  <div className="mt-2">
                    <Progress value={summary.progress} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
