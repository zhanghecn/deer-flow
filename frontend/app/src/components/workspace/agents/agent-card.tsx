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
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: AgentDirectoryEntry;
}

type DeleteTarget = AgentStatus | "all";

function getDefaultStatusLabel(
  agent: AgentDirectoryEntry,
  t: ReturnType<typeof useI18n>["t"],
) {
  return getAgentDirectoryDefaultTarget(agent) === "draft"
    ? t.agents.defaultDraft
    : t.agents.defaultPublished;
}

function getAvailabilityLabel(
  agent: AgentDirectoryEntry,
  t: ReturnType<typeof useI18n>["t"],
) {
  const availability = getAgentDirectoryAvailability(agent);
  if (availability === "publishedReady") {
    return t.agents.publishedReady;
  }
  return availability === "draftOnly"
    ? t.agents.draftOnly
    : t.agents.publishedOnly;
}

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
        // The gallery card represents multiple archives, so the delete dialog
        // must pass an explicit status when removing only one side.
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
      <article className="grid gap-4 rounded-md border bg-background px-4 py-4 transition-colors hover:border-border/90 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(220px,0.9fr)]">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-md border">
            <BotIcon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{agent.name}</h2>
              {agent.name === "lead_agent" && (
                <Badge variant="outline" className="rounded-sm text-[10px]">
                  {t.agents.coreBadge}
                </Badge>
              )}
              {!agent.canManage && (
                <Badge variant="outline" className="rounded-sm text-[10px]">
                  {t.agents.readOnlyBadge}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground line-clamp-2 text-sm leading-6">
              {agent.description || t.agents.switcher.builtinDescription}
            </p>
          </div>
        </div>

        {/* Keep status metadata in a compact facts column so the page reads
            like a directory, not a card mosaic. */}
        <dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-sm border bg-muted/20 px-3 py-2">
            <dt className="text-muted-foreground text-[11px] uppercase tracking-[0.14em]">
              Default
            </dt>
            <dd className="mt-1 font-medium">{getDefaultStatusLabel(agent, t)}</dd>
          </div>
          <div className="rounded-sm border bg-muted/20 px-3 py-2">
            <dt className="text-muted-foreground text-[11px] uppercase tracking-[0.14em]">
              Availability
            </dt>
            <dd className="mt-1 font-medium">
              {getAvailabilityLabel(agent, t)}
            </dd>
          </div>
          <div className="rounded-sm border bg-muted/20 px-3 py-2">
            <dt className="text-muted-foreground text-[11px] uppercase tracking-[0.14em]">
              Draft
            </dt>
            <dd className="mt-1 font-medium">
              {agent.devAgent ? "Available" : "Missing"}
            </dd>
          </div>
          <div className="rounded-sm border bg-muted/20 px-3 py-2">
            <dt className="text-muted-foreground text-[11px] uppercase tracking-[0.14em]">
              Published
            </dt>
            <dd className="mt-1 font-medium">
              {agent.prodAgent ? "Available" : "Missing"}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2 border-t pt-3 sm:border-t-0 sm:pt-0 xl:border-l xl:pl-4">
          <Button className="w-full" onClick={handleChat}>
            <MessageSquareIcon className="mr-1.5 h-4 w-4" />
            {t.agents.startChatting}
          </Button>
          {(agent.canManage || canPublish || canDelete) && (
            <div className="grid w-full gap-2">
              <div
                className={cn(
                  "grid gap-2",
                  agent.canManage && canPublish ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {agent.canManage && (
                  <Button
                    className="justify-start"
                    variant="outline"
                    onClick={handleOpenSettings}
                  >
                    <Settings2Icon className="mr-1.5 h-3.5 w-3.5" />
                    {t.common.settings}
                  </Button>
                )}
                {canPublish && (
                  <Button
                    className="justify-start"
                    variant="outline"
                    onClick={handlePublish}
                    disabled={publishAgentMutation.isPending}
                  >
                    <RocketIcon className="mr-1.5 h-3.5 w-3.5" />
                    {t.agents.publishToProd}
                  </Button>
                )}
              </div>
              {canDelete && (
                <div className="flex w-full justify-end pt-1">
                  <Button
                    className={cn(
                      "border-destructive/25 text-destructive hover:bg-destructive/5 hover:text-destructive",
                    )}
                    variant="outline"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon className="mr-1.5 h-4 w-4" />
                    {t.agents.delete}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </article>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.deleteArchiveTitle(agent.name)}</DialogTitle>
            <DialogDescription>
              {t.agents.deleteArchiveDescription(agent.name)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {hasDraftArchive && (
              <Button
                variant="destructive"
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
