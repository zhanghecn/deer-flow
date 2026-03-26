import {
  ArrowUpRightIcon,
  BrainCircuitIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { useThreadKnowledgeBases } from "@/core/knowledge/hooks";
import { useI18n } from "@/core/i18n/hooks";

import { KnowledgeBaseUploadDialog } from "./knowledge-base-upload-dialog";

function statusLabel(status: string, labels: Record<string, string>) {
  switch (status) {
    case "queued":
      return labels.queued;
    case "ready":
      return labels.ready;
    case "processing":
      return labels.processing;
    case "error":
      return labels.error;
    default:
      return status;
  }
}

function documentStatus(document: {
  status: string;
  latest_build_job?: { status?: string };
}) {
  return document.latest_build_job?.status ?? document.status;
}

function documentProgress(document: {
  status: string;
  latest_build_job?: { progress_percent?: number; status?: string };
}) {
  const status = documentStatus(document);
  if (status === "ready") {
    return 100;
  }
  return document.latest_build_job?.progress_percent ?? 0;
}

export function ThreadKnowledgeSidebarSection() {
  const { thread_id: threadId, agent_name: agentName } = useParams();
  const { knowledgeBases, isLoading } = useThreadKnowledgeBases(threadId);
  const { t } = useI18n();
  const statusLabels = t.knowledge.status;

  const [dialogOpen, setDialogOpen] = useState(false);

  if (!threadId) {
    return null;
  }

  const managePath = agentName
    ? `/workspace/agents/${agentName}/chats/${threadId}/knowledge`
    : `/workspace/chats/${threadId}/knowledge`;

  return (
    <>
      <KnowledgeBaseUploadDialog
        threadId={threadId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <SidebarGroup>
        <SidebarGroupLabel>
          <BrainCircuitIcon className="mr-2" />
          {t.knowledge.sectionTitle}
        </SidebarGroupLabel>
        <SidebarGroupAction onClick={() => setDialogOpen(true)}>
          <PlusIcon />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <div className="space-y-2 px-2 pb-2 text-xs">
            <Button
              variant="default"
              className="w-full justify-between"
              onClick={() => setDialogOpen(true)}
            >
              {t.knowledge.uploadButton}
              <UploadIcon className="size-4" />
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full justify-between"
            >
              <Link to={managePath}>
                {t.knowledge.manageButton}
                <ArrowUpRightIcon className="size-4" />
              </Link>
            </Button>
            {isLoading ? (
              <div className="text-muted-foreground">
                {t.knowledge.loadingAttached}
              </div>
            ) : knowledgeBases.length === 0 ? (
              <div className="text-muted-foreground">
                {t.knowledge.emptyAttached}
              </div>
            ) : (
              knowledgeBases.map((knowledgeBase) => (
                <div
                  key={knowledgeBase.id}
                  className="border-border/60 bg-sidebar-accent/20 rounded-md border p-2"
                >
                  <div className="font-medium">{knowledgeBase.name}</div>
                  {knowledgeBase.description ? (
                    <div className="text-muted-foreground mt-1 line-clamp-2">
                      {knowledgeBase.description}
                    </div>
                  ) : null}
                  <div className="mt-2 space-y-1">
                    {knowledgeBase.documents.map((document) => (
                      <div
                        key={document.id}
                        className="bg-background/40 flex items-start justify-between gap-2 rounded-sm px-2 py-1"
                      >
                        <div className="min-w-0">
                          <div className="truncate">
                            {document.display_name}
                          </div>
                          <div className="text-muted-foreground truncate">
                            {document.file_kind} · {document.locator_type}
                          </div>
                          {documentStatus(document) !== "ready" ? (
                            <div className="mt-1 space-y-1">
                              <Progress value={documentProgress(document)} />
                              {document.latest_build_job?.stage ? (
                                <div className="text-muted-foreground truncate">
                                  {document.latest_build_job.stage}
                                  {document.latest_build_job.message
                                    ? ` · ${document.latest_build_job.message}`
                                    : ""}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {document.error ? (
                            <div className="truncate text-red-500">
                              {document.error}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground shrink-0">
                          {statusLabel(documentStatus(document), statusLabels)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
