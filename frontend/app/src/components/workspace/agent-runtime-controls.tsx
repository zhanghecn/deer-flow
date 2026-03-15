"use client";

import { CopyIcon, ExternalLinkIcon, LaptopIcon, PlugZapIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildWorkspaceAgentPath,
  isLeadAgent,
  type Agent,
  type AgentStatus,
  useAgents,
} from "@/core/agents";
import { cn } from "@/lib/utils";

type RuntimeValue = {
  agent_name?: string;
  agent_status?: AgentStatus;
  execution_backend?: "remote";
  remote_session_id?: string;
};

interface AgentRuntimeControlsProps {
  value: RuntimeValue;
  onValueChange: (nextValue: RuntimeValue) => void;
  className?: string;
  showLaunchActions?: boolean;
}

function uniqueAgentsByName(agents: Agent[]) {
  const seen = new Set<string>();
  const result: { name: string; statuses: AgentStatus[] }[] = [];

  for (const agent of agents) {
    if (seen.has(agent.name)) {
      continue;
    }
    const statuses = agents
      .filter((item) => item.name === agent.name)
      .map((item) => item.status);
    seen.add(agent.name);
    result.push({
      name: agent.name,
      statuses: Array.from(new Set(statuses)),
    });
  }

  if (!seen.has("lead_agent")) {
    result.unshift({ name: "lead_agent", statuses: ["dev"] });
  }

  result.sort((a, b) => {
    if (a.name === "lead_agent") return -1;
    if (b.name === "lead_agent") return 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

export function AgentRuntimeControls({
  value,
  onValueChange,
  className,
  showLaunchActions = false,
}: AgentRuntimeControlsProps) {
  const { agents } = useAgents();

  const agentOptions = useMemo(() => uniqueAgentsByName(agents), [agents]);
  const normalizedAgentName = value.agent_name?.trim();
  const effectiveAgentName =
    normalizedAgentName && normalizedAgentName.length > 0
      ? normalizedAgentName
      : "lead_agent";
  const requestedStatus = value.agent_status ?? "dev";
  const matchedAgent = useMemo(
    () => agentOptions.find((item) => item.name === effectiveAgentName),
    [agentOptions, effectiveAgentName],
  );
  const availableStatuses = useMemo(() => {
    if (matchedAgent?.statuses.length) {
      return Array.from(
        new Set<AgentStatus>([requestedStatus, ...matchedAgent.statuses]),
      );
    }
    return [requestedStatus];
  }, [matchedAgent, requestedStatus]);
  const effectiveStatus = matchedAgent?.statuses.length
    ? matchedAgent.statuses.includes(requestedStatus)
      ? requestedStatus
      : matchedAgent.statuses[0]!
    : requestedStatus;
  const runtimeMode = value.execution_backend === "remote" ? "remote" : "default";
  const launchPath = buildWorkspaceAgentPath({
    agentName: effectiveAgentName,
    agentStatus: effectiveStatus,
    executionBackend: value.execution_backend,
    remoteSessionId: value.remote_session_id,
  });

  useEffect(() => {
    if (!matchedAgent?.statuses.length || effectiveStatus === value.agent_status) {
      return;
    }
    onValueChange({
      ...value,
      agent_name: effectiveAgentName,
      agent_status: effectiveStatus,
    });
  }, [effectiveAgentName, effectiveStatus, matchedAgent, onValueChange, value]);

  async function handleCopyLaunchURL() {
    const origin = window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}${launchPath}`);
      toast.success("Demo URL copied");
    } catch {
      toast.error("Failed to copy demo URL");
    }
  }

  return (
    <div
      className={cn(
        "bg-background/75 border-border/65 rounded-2xl border px-4 py-3 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <LaptopIcon className="size-3.5" />
          {isLeadAgent(effectiveAgentName) ? "lead_agent" : effectiveAgentName}
        </Badge>
        <Badge variant="outline">{effectiveStatus}</Badge>
        <Badge variant="outline" className="gap-1.5">
          <PlugZapIcon className="size-3.5" />
          {runtimeMode === "remote" ? "remote cli" : "default runtime"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.2fr)_140px_160px]">
        <Select
          value={effectiveAgentName}
          onValueChange={(agent_name) =>
            onValueChange({
              ...value,
              agent_name,
              agent_status:
                agentOptions.find((item) => item.name === agent_name)?.statuses[0] ??
                "dev",
            })
          }
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue placeholder="Agent">{effectiveAgentName}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agentOptions.map((agent) => (
              <SelectItem key={agent.name} value={agent.name}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={effectiveStatus}
          onValueChange={(agent_status) =>
            onValueChange({
              ...value,
              agent_name: effectiveAgentName,
              agent_status: agent_status as AgentStatus,
            })
          }
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue placeholder="Archive">{effectiveStatus}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={runtimeMode}
          onValueChange={(mode) =>
            onValueChange({
              ...value,
              execution_backend: mode === "remote" ? "remote" : undefined,
              remote_session_id:
                mode === "remote" ? value.remote_session_id : undefined,
            })
          }
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue placeholder="Runtime">
              {runtimeMode === "remote" ? "remote cli" : "default runtime"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">default runtime</SelectItem>
            <SelectItem value="remote">remote cli</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {runtimeMode === "remote" && (
        <div className="mt-2">
          <Input
            value={value.remote_session_id ?? ""}
            onChange={(event) =>
              onValueChange({
                ...value,
                remote_session_id: event.target.value,
              })
            }
            placeholder="remote session id"
            className="h-8"
          />
        </div>
      )}

      {showLaunchActions && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleCopyLaunchURL}>
            <CopyIcon className="size-3.5" />
            Copy URL
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={launchPath}>
              <ExternalLinkIcon className="size-3.5" />
              Open Demo
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
