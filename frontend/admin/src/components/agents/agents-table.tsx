import { Bot, Eye, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import {
  getAgentVersionBadges,
  getPrimaryAgent,
  type AgentRecord,
} from "@/lib/agents";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface AgentsTableProps {
  agents: AgentRecord[] | null;
  isLoading: boolean;
  onRefetch: () => void;
  onViewDetail: (agent: AgentRecord) => void;
}

export function AgentsTable({
  agents,
  isLoading,
  onRefetch,
  onViewDetail,
}: AgentsTableProps) {
  async function handlePublish(agent: AgentRecord) {
    if (!agent.draft) {
      return;
    }

    try {
      await api(`/api/agents/${agent.draft.name}/publish`, { method: "POST" });
      toast.success(t("{name} published", { name: agent.draft.name }));
      onRefetch();
    } catch {
      toast.error(t("Failed to publish agent"));
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!agents?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Bot className="h-12 w-12 mb-2 opacity-40" />
        <p>{t("No agents found")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Name")}</TableHead>
            <TableHead>{t("Versions")}</TableHead>
            <TableHead className="text-right">{t("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow
              key={agent.name}
              className="cursor-pointer"
              onClick={() => onViewDetail(agent)}
            >
              <TableCell className="align-top">
                <div className="space-y-1">
                  <button
                    type="button"
                    className="font-mono text-left text-sm font-medium hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewDetail(agent);
                    }}
                  >
                    {agent.name}
                  </button>
                  <p className="text-muted-foreground max-w-xl text-xs">
                    {getPrimaryAgent(agent)?.description || t("No description")}
                  </p>
                </div>
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap gap-1.5">
                  {getAgentVersionBadges(agent).map((badge) => (
                    <Badge
                      key={`${agent.name}:${badge.label}`}
                      variant={badge.variant}
                    >
                      {t(badge.label)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewDetail(agent);
                    }}
                  >
                    <Eye className="h-4 w-4" />
                    {t("Manage")}
                  </Button>
                  {agent.draft && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handlePublish(agent);
                      }}
                    >
                      <Rocket className="h-4 w-4" />
                      {t("Publish")}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
