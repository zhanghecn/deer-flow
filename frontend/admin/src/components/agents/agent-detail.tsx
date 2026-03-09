import type { ReactNode } from "react";

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

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}

export function AgentDetail({ agent, open, onOpenChange }: AgentDetailProps) {
  if (!agent) return null;

  const memory = agent.memory;
  const memoryEnabled = memory?.enabled ?? false;

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
              <DetailField label="Name" value={agent.name} mono />
              <DetailField label="Model" value={agent.model || "-"} />
              <DetailField label="Created" value={formatDate(agent.created_at)} />
              <DetailField label="Updated" value={formatDate(agent.updated_at)} />
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

            <Separator />
            <div>
              <h4 className="mb-1 text-sm font-medium">Memory Policy</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <DetailField
                  label="Scope"
                  value="user_id + agent_name + status"
                  mono
                />
                <DetailField
                  label="Enabled"
                  value={
                    <Badge variant={memoryEnabled ? "default" : "outline"}>
                      {memoryEnabled ? "On" : "Off"}
                    </Badge>
                  }
                />
                <DetailField label="Model" value={memory?.model_name || "-"} />
                <DetailField
                  label="Injection"
                  value={memory?.injection_enabled ? "On" : "Off"}
                />
                <DetailField
                  label="Debounce"
                  value={
                    memory?.debounce_seconds != null
                      ? `${memory.debounce_seconds}s`
                      : "-"
                  }
                />
                <DetailField label="Max facts" value={memory?.max_facts ?? "-"} />
                <DetailField
                  label="Confidence threshold"
                  value={memory?.fact_confidence_threshold ?? "-"}
                />
                <DetailField
                  label="Max injection tokens"
                  value={memory?.max_injection_tokens ?? "-"}
                />
              </div>
            </div>

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
