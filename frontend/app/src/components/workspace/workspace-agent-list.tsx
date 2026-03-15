"use client";

import { BotIcon } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { buildWorkspaceAgentPath, type Agent, useAgents } from "@/core/agents";

function sortAgents(agents: Agent[]) {
  return [...agents].sort((a, b) => {
    if (a.name === "lead_agent") return -1;
    if (b.name === "lead_agent") return 1;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.status.localeCompare(b.status);
  });
}

export function WorkspaceAgentList() {
  const pathname = usePathname();
  const params = useParams<{ agent_name?: string }>();
  const searchParams = useSearchParams();
  const { agents } = useAgents();

  const currentAgentName =
    params.agent_name ?? searchParams.get("agent_name") ?? "lead_agent";
  const currentStatus = searchParams.get("agent_status") ?? "dev";
  const isChatRoute =
    pathname.startsWith("/workspace/chats/") ||
    pathname.startsWith("/workspace/agents/");

  if (agents.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupLabel>Agents</SidebarGroupLabel>
      <SidebarGroupContent className="group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
        <SidebarMenu>
          {sortAgents(agents).map((agent) => {
            const isActive =
              isChatRoute &&
              currentAgentName === agent.name &&
              currentStatus === agent.status;
            return (
              <SidebarMenuItem key={`${agent.name}:${agent.status}`}>
                <SidebarMenuButton isActive={isActive} asChild>
                  <Link href={buildWorkspaceAgentPath({ agentName: agent.name, agentStatus: agent.status })}>
                    <BotIcon />
                    <span className="truncate">{agent.name}</span>
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {agent.status}
                    </Badge>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
