import {
  BotIcon,
  MessageSquareIcon,
  RocketIcon,
  Settings2Icon,
} from "lucide-react";
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
  buildWorkspaceAgentPath,
  buildWorkspaceAgentSettingsPath,
  getAgentDirectoryAvailability,
  getAgentDirectoryDefaultTarget,
  type AgentDirectoryEntry,
  usePublishAgent,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

interface AgentCardProps {
  agent: AgentDirectoryEntry;
}

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
  const publishAgentMutation = usePublishAgent();
  const canPublish = agent.canManage && agent.devAgent != null;
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

  return (
    <Card className="group bg-background dark:glass dark:hover:glow-cyan flex h-full flex-col transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
            <BotIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base">{agent.name}</CardTitle>
              {agent.name === "lead_agent" && (
                <Badge variant="outline" className="text-xs">
                  {t.agents.coreBadge}
                </Badge>
              )}
              {!agent.canManage && (
                <Badge variant="outline" className="text-xs">
                  {t.agents.readOnlyBadge}
                </Badge>
              )}
            </div>
            <CardDescription className="mt-2 line-clamp-2 text-sm">
              {agent.description || t.agents.switcher.builtinDescription}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0 pb-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs">
            {getDefaultStatusLabel(agent, t)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {getAvailabilityLabel(agent, t)}
          </Badge>
        </div>
      </CardContent>

      <CardFooter className="mt-auto flex flex-col gap-2 pt-0">
        <Button className="w-full" onClick={handleChat}>
          <MessageSquareIcon className="mr-1.5 h-4 w-4" />
          {t.agents.startChatting}
        </Button>
        <div className="flex w-full gap-2">
          {agent.canManage && (
            <Button className="flex-1" variant="outline" onClick={handleOpenSettings}>
              <Settings2Icon className="mr-1.5 h-3.5 w-3.5" />
              {t.common.settings}
            </Button>
          )}
          {canPublish && (
            <Button
              className="flex-1"
              variant="outline"
              onClick={handlePublish}
              disabled={publishAgentMutation.isPending}
            >
              <RocketIcon className="mr-1.5 h-3.5 w-3.5" />
              {t.agents.publishToProd}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
