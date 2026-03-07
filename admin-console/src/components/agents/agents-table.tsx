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
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
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
      toast.success(`${agent.display_name || agent.name} published`);
      onRefetch();
    } catch {
      toast.error("Failed to publish agent");
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
        <p>No agents found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Display Name</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.id}>
              <TableCell className="font-mono text-sm">{agent.name}</TableCell>
              <TableCell className="font-medium">
                {agent.display_name || agent.name}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {agent.model || "-"}
              </TableCell>
              <TableCell>
                <Badge
                  variant={agent.status === "prod" ? "default" : "secondary"}
                >
                  {agent.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(agent.updated_at)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onViewDetail(agent)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View Details</TooltipContent>
                  </Tooltip>
                  {agent.status === "dev" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePublish(agent)}
                        >
                          <Rocket className="h-4 w-4 text-emerald-600" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Publish</TooltipContent>
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
