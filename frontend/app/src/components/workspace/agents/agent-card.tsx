import {
  BotIcon,
  MessageSquareIcon,
  RocketIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildWorkspaceAgentPath,
  buildWorkspaceAgentSettingsPath,
  getAgentDirectoryAvailability,
  getAgentDirectoryDefaultTarget,
  type AgentDirectoryEntry,
  type AgentStatus,
  useDeleteAgent,
  usePublishAgent,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

interface AgentCardProps {
  agent: AgentDirectoryEntry;
}

type DeleteTarget = AgentStatus | "all";

export function AgentCard({ agent }: AgentCardProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteTarget, setPendingDeleteTarget] =
    useState<DeleteTarget | null>(null);
  const deleteAgentMutation = useDeleteAgent();
  const publishAgentMutation = usePublishAgent();
  const canPublish = agent.canManage && agent.devAgent != null;
  const canDelete =
    agent.canManage &&
    agent.name !== "lead_agent" &&
    (agent.devAgent != null || agent.prodAgent != null);
  const hasDraftArchive = agent.devAgent != null;
  const hasPublishedArchive = agent.prodAgent != null;
  const availability = getAgentDirectoryAvailability(agent);
  const defaultTarget = getAgentDirectoryDefaultTarget(agent);
  const launchPath = buildWorkspaceAgentPath({
    agentName: agent.name,
    agentStatus: agent.defaultChatStatus,
  });
  const settingsPath = buildWorkspaceAgentSettingsPath({
    agentName: agent.name,
    agentStatus: agent.defaultSettingsStatus,
  });

  function handleChat() {
    void navigate(launchPath);
  }

  async function handlePublish() {
    try {
      await publishAgentMutation.mutateAsync(agent.name);
      toast.success(t.agents.publishSuccess(agent.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function handleOpenSettings() {
    void navigate(settingsPath);
  }

  function getDeleteSuccessMessage(target: DeleteTarget) {
    if (target === "dev") {
      return t.agents.deleteDraftSuccess(agent.name);
    }
    if (target === "prod") {
      return t.agents.deletePublishedSuccess(agent.name);
    }
    return t.agents.deleteAllArchivesSuccess(agent.name);
  }

  async function handleDelete(target: DeleteTarget) {
    setPendingDeleteTarget(target);

    try {
      await deleteAgentMutation.mutateAsync({
        name: agent.name,
        status: target === "all" ? undefined : target,
      });
      toast.success(getDeleteSuccessMessage(target));
      setDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingDeleteTarget(null);
    }
  }

  return (
    <>
      {/* Card — minimal shadow, calmer hover, tighter spacing */}
      <article className="group flex flex-col rounded-lg border bg-background transition-colors hover:border-border hover:bg-accent/30">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 pb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <BotIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
              {agent.name === "lead_agent" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {t.agents.coreBadge}
                </Badge>
              )}
              {!agent.canManage && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                  {t.agents.readOnlyBadge}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
              {agent.description || t.agents.switcher.builtinDescription}
            </p>
          </div>
        </div>

        {/* Status pills — smaller, calmer */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {hasDraftArchive && (
            <span className="inline-flex items-center rounded-full bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {t.agents.draftBadge}
            </span>
          )}
          {hasPublishedArchive && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/8 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              {t.agents.publishedBadge}
            </span>
          )}
          <span className="text-muted-foreground/70 text-[10px]">
            {availability === "publishedReady"
              ? t.agents.publishedReady
              : availability === "draftOnly"
                ? t.agents.draftOnly
                : t.agents.publishedOnly}
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="text-muted-foreground/70 text-[10px]">
            {defaultTarget === "draft"
              ? t.agents.defaultDraft
              : t.agents.defaultPublished}
          </span>
        </div>

        {/* Actions — primary chat button stands out, secondary actions are ghost */}
        <div className="mt-auto border-t px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleChat}>
              <MessageSquareIcon className="mr-1 h-3.5 w-3.5" />
              {t.agents.startChatting}
            </Button>
            {agent.canManage && (
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleOpenSettings}>
                <Settings2Icon className="h-4 w-4" />
              </Button>
            )}
            {canPublish && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={handlePublish}
                disabled={publishAgentMutation.isPending}
              >
                <RocketIcon className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </article>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="gap-4">
          <DialogHeader>
            <DialogTitle className="text-base">{t.agents.deleteArchiveTitle(agent.name)}</DialogTitle>
            <DialogDescription>
              {t.agents.deleteArchiveDescription(agent.name)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {hasDraftArchive && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete("dev")}
                disabled={pendingDeleteTarget != null}
              >
                {pendingDeleteTarget === "dev" && (
                  <Trash2Icon className="size-4 animate-pulse" />
                )}
                {t.agents.deleteDraft}
              </Button>
            )}
            {hasPublishedArchive && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete("prod")}
                disabled={pendingDeleteTarget != null}
              >
                {pendingDeleteTarget === "prod" && (
                  <Trash2Icon className="size-4 animate-pulse" />
                )}
                {t.agents.deletePublished}
              </Button>
            )}
            {hasDraftArchive && hasPublishedArchive && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete("all")}
                disabled={pendingDeleteTarget != null}
              >
                {pendingDeleteTarget === "all" && (
                  <Trash2Icon className="size-4 animate-pulse" />
                )}
                {t.agents.deleteAllArchives}
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(false)}
            disabled={pendingDeleteTarget != null}
          >
            {t.common.cancel}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
