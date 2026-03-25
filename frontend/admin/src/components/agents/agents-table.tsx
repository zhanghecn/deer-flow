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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { Agent } from "@/types";
import { toast } from "sonner";

interface AgentsTableProps {
  agents: Agent[] | null;
  isLoading: boolean;
  onRefetch: () => void;
  onViewDetail: (agent: Agent) => void;
}

export function AgentsTable({
  agents,
  isLoading,
  onRefetch,
  onViewDetail,
}: AgentsTableProps) {
  async function handlePublish(agent: Agent) {
    try {
      await api(`/api/agents/${agent.name}/publish`, { method: "POST" });
      toast.success(t("{name} published", { name: agent.name }));
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
            <TableHead>{t("Model")}</TableHead>
            <TableHead>{t("Memory")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="text-right">{t("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow
              key={`${agent.name}:${agent.status}`}
              className="cursor-pointer"
              onClick={() => onViewDetail(agent)}
            >
              <TableCell className="font-mono text-sm">
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewDetail(agent);
                  }}
                >
                  {agent.name}
                </button>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {agent.model || "-"}
              </TableCell>
              <TableCell className="text-sm">
                {agent.memory?.enabled ? (
                  <Badge variant="outline">
                    {agent.memory.model_name || t("Enabled")}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">{t("Off")}</span>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={agent.status === "prod" ? "default" : "secondary"}
                >
                  {t(agent.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewDetail(agent);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("View Details")}</TooltipContent>
                  </Tooltip>
                  {agent.status === "dev" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePublish(agent);
                          }}
                        >
                          <Rocket className="h-4 w-4 text-emerald-600" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("Publish")}</TooltipContent>
                    </Tooltip>
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
