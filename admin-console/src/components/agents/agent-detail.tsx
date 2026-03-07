import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/format";
import type { Agent } from "@/types";

interface AgentDetailProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentDetail({ agent, open, onOpenChange }: AgentDetailProps) {
  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {agent.display_name || agent.name}
            <Badge variant={agent.status === "prod" ? "default" : "secondary"}>
              {agent.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>{" "}
                <span className="font-mono">{agent.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Model:</span>{" "}
                {agent.model || "-"}
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>{" "}
                {formatDate(agent.created_at)}
              </div>
              <div>
                <span className="text-muted-foreground">Updated:</span>{" "}
                {formatDate(agent.updated_at)}
              </div>
            </div>

            {agent.description && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-1">Description</h4>
                  <p className="text-sm text-muted-foreground">
                    {agent.description}
                  </p>
                </div>
              </>
            )}

            {agent.tool_groups && agent.tool_groups.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-1">Tool Groups</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.tool_groups.map((g) => (
                      <Badge key={g} variant="outline">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {agent.mcp_servers && agent.mcp_servers.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-1">MCP Servers</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.mcp_servers.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {agent.agents_md && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-1">Agent Markdown</h4>
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-auto whitespace-pre-wrap">
                    {agent.agents_md}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
