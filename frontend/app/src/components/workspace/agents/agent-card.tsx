import {
  BotIcon,
  BrainIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildWorkspaceAgentSettingsPath,
  useClaimAgent,
  useDeleteAgent,
  useDownloadAgentReactDemo,
  usePublishAgent,
} from "@/core/agents";
import { buildWorkspaceAgentPath } from "@/core/agents";
import type { Agent } from "@/core/agents";
import { useAuth } from "@/core/auth/hooks";
import { useI18n } from "@/core/i18n/hooks";
interface AgentCardProps {
  agent: Agent;
}

function getAgentMemoryBadgeLabel(
  agent: Agent,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (!agent.memory?.enabled) {
    return t.agents.memoryOff;
  }
  return agent.memory.model_name
    ? t.agents.memoryWithModel(agent.memory.model_name)
    : t.agents.memoryOn;
}

export function AgentCard({ agent }: AgentCardProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const claimAgent = useClaimAgent();
  const deleteAgent = useDeleteAgent();
  const downloadDemoMutation = useDownloadAgentReactDemo();
  const publishAgentMutation = usePublishAgent();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isProd = agent.status === "prod";
  const canManage = agent.can_manage !== false;
  const memoryEnabled = agent.memory?.enabled ?? false;
  const memoryLabel = getAgentMemoryBadgeLabel(agent, t);
  const isBuiltinLeadAgent = agent.name === "lead_agent";
  const isOwnerlessLegacyAgent = !isBuiltinLeadAgent && !agent.owner_user_id;
  const ownerLabel = isOwnerlessLegacyAgent
    ? t.agents.legacyOwnerless
    : agent.owner_user_id === user?.id
      ? t.agents.ownedByYou
      : t.agents.ownedBy(agent.owner_name ?? agent.owner_user_id ?? "");
  const launchPath = buildWorkspaceAgentPath({
    agentName: agent.name,
    agentStatus: agent.status,
  });

  function handleChat() {
    void navigate(launchPath);
  }

  async function handleCopyLaunchURL() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${launchPath}`,
      );
      toast.success(t.clipboard.linkCopied);
    } catch {
      toast.error(t.clipboard.failedToCopyToClipboard);
    }
  }

  async function handlePublish() {
    try {
      await publishAgentMutation.mutateAsync(agent.name);
      toast.success(t.agents.publishSuccess(agent.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownloadReactDemo() {
    try {
      const filename = await downloadDemoMutation.mutateAsync(agent.name);
      toast.success(t.agents.downloadSuccess(filename));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    try {
      await deleteAgent.mutateAsync(agent.name);
      toast.success(t.agents.deleteSuccess);
      setDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleClaimOwnership() {
    try {
      await claimAgent.mutateAsync({ name: agent.name, status: agent.status });
      toast.success(t.agents.claimOwnershipSuccess(agent.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function handleOpenSettings() {
    void navigate(
      buildWorkspaceAgentSettingsPath({
        agentName: agent.name,
        agentStatus: agent.status,
      }),
    );
  }

  return (
    <>
      <Card className="group bg-background dark:glass dark:hover:glow-cyan flex flex-col transition-shadow hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <BotIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-base">
                  {agent.name}
                </CardTitle>
                <div className="mt-0.5 flex gap-1">
                  {agent.status && (
                    <Badge
                      variant={isProd ? "default" : "outline"}
                      className={`text-xs ${isProd ? "bg-green-600 text-white" : ""}`}
                    >
                      {agent.status}
                    </Badge>
                  )}
                  {agent.model && (
                    <Badge variant="secondary" className="text-xs">
                      {agent.model}
                    </Badge>
                  )}
                  {!canManage && (
                    <Badge variant="outline" className="text-xs">
                      {t.agents.readOnlyBadge}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
          {agent.description && (
            <CardDescription className="mt-2 line-clamp-2 text-sm">
              {agent.description}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-3 pt-0 pb-3">
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-xs">
              {t.agents.ownerBadge}: {ownerLabel}
            </Badge>
            <Badge
              variant={memoryEnabled ? "secondary" : "outline"}
              className="inline-flex items-center gap-1 text-xs"
            >
              <BrainIcon className="h-3 w-3" />
              {memoryLabel}
            </Badge>
          </div>
          {agent.tool_groups && agent.tool_groups.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {agent.tool_groups.map((group) => (
                <Badge key={group} variant="outline" className="text-xs">
                  {group}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <Button
            size="sm"
            className="min-w-[120px] flex-1"
            onClick={handleChat}
          >
            <MessageSquareIcon className="mr-1.5 h-3.5 w-3.5" />
            {t.agents.chat}
          </Button>
          {canManage && (
            <Button size="sm" variant="outline" onClick={handleOpenSettings}>
              <Settings2Icon className="mr-1.5 h-3.5 w-3.5" />
              {t.common.settings}
            </Button>
          )}
          {isOwnerlessLegacyAgent && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleClaimOwnership}
              disabled={claimAgent.isPending}
            >
              {claimAgent.isPending ? (
                <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Settings2Icon className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t.agents.claimOwnership}
            </Button>
          )}
          <div className="ml-auto flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={handleCopyLaunchURL}
              title={t.agents.copyUrl}
            >
              <CopyIcon className="h-3.5 w-3.5" />
            </Button>
            {!isProd && canManage && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handlePublish}
                disabled={publishAgentMutation.isPending}
                title={t.agents.publish}
              >
                <RocketIcon className="h-3.5 w-3.5" />
              </Button>
            )}
            {isProd && canManage && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handleDownloadReactDemo}
                disabled={downloadDemoMutation.isPending}
                title={t.agents.downloadDemo}
              >
                {downloadDemoMutation.isPending ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadIcon className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {canManage && !isBuiltinLeadAgent && (
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive h-8 w-8 shrink-0"
                onClick={() => setDeleteOpen(true)}
                title={t.agents.delete}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>

      {/* Delete Confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.delete}</DialogTitle>
            <DialogDescription>{t.agents.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteAgent.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteAgent.isPending}
            >
              {deleteAgent.isPending ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
