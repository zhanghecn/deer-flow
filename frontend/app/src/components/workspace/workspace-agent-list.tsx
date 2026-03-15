"use client";

import {
  ArrowRightLeftIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LaptopIcon,
  PlugZapIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  SidebarGroupAction,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { AgentSettingsDialog } from "@/components/workspace/agent-settings-dialog";
import {
  buildWorkspaceAgentPath,
  isLeadAgent,
  type Agent,
  type AgentStatus,
  useAgents,
} from "@/core/agents";
import { cn } from "@/lib/utils";

type AgentDirectoryEntry = {
  name: string;
  description: string;
  statuses: AgentStatus[];
};

function groupAgents(agents: Agent[]) {
  const byName = new Map<string, AgentDirectoryEntry>();

  for (const agent of agents) {
    const existing = byName.get(agent.name);
    const description = agent.description?.trim() ?? "";

    if (!existing) {
      byName.set(agent.name, {
        name: agent.name,
        description,
        statuses: [agent.status],
      });
      continue;
    }

    existing.statuses = Array.from(
      new Set<AgentStatus>([...existing.statuses, agent.status]),
    ).sort((a, b) => (a === b ? 0 : a === "dev" ? -1 : 1));

    if (!existing.description && description) {
      existing.description = description;
    }
  }

  if (!byName.has("lead_agent")) {
    byName.set("lead_agent", {
      name: "lead_agent",
      description: "Built-in orchestration agent",
      statuses: ["dev", "prod"],
    });
  }

  return [...byName.values()].sort((a, b) => {
    if (a.name === "lead_agent") return -1;
    if (b.name === "lead_agent") return 1;
    return a.name.localeCompare(b.name);
  });
}

function normalizeStatus(
  requestedStatus: string | null,
  statuses: AgentStatus[],
) {
  if (requestedStatus === "prod" && statuses.includes("prod")) {
    return "prod";
  }
  if (statuses.includes("dev")) {
    return "dev";
  }
  return statuses[0] ?? "dev";
}

export function WorkspaceAgentList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { agents } = useAgents();
  const [remoteDraft, setRemoteDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const groupedAgents = useMemo(() => groupAgents(agents), [agents]);
  const currentAgentName = useMemo(() => {
    const agentRoute = /^\/workspace\/agents\/([^/]+)\/chats\//;
    const matched = agentRoute.exec(pathname);
    if (matched?.[1]) {
      return decodeURIComponent(matched[1]);
    }
    return searchParams.get("agent_name") ?? "lead_agent";
  }, [pathname, searchParams]);
  const currentStatus = searchParams.get("agent_status") ?? "dev";
  const currentExecutionBackend =
    searchParams.get("execution_backend") === "remote" ? "remote" : undefined;
  const currentRemoteSessionId = searchParams.get("remote_session_id") ?? "";

  const selectedAgent = useMemo(() => {
    return (
      groupedAgents.find((agent) => agent.name === currentAgentName) ??
      groupedAgents[0] ?? {
        name: "lead_agent",
        description: "Built-in orchestration agent",
        statuses: ["dev", "prod"] satisfies AgentStatus[],
      }
    );
  }, [currentAgentName, groupedAgents]);
  const selectedStatus = normalizeStatus(currentStatus, selectedAgent.statuses);
  const launchPath = buildWorkspaceAgentPath({
    agentName: selectedAgent.name,
    agentStatus: selectedStatus,
    executionBackend: currentExecutionBackend,
    remoteSessionId: currentRemoteSessionId || undefined,
  });

  useEffect(() => {
    setRemoteDraft(currentRemoteSessionId);
  }, [currentRemoteSessionId]);

  const navigateToSelection = useCallback(
    (selection: {
      agentName: string;
      agentStatus: AgentStatus;
      executionBackend?: "remote";
      remoteSessionId?: string;
    }) => {
      router.push(
        buildWorkspaceAgentPath(
          {
            agentName: selection.agentName,
            agentStatus: selection.agentStatus,
            executionBackend: selection.executionBackend,
            remoteSessionId: selection.remoteSessionId,
          },
          "new",
        ),
      );
    },
    [router],
  );

  const handleStatusSelect = useCallback(
    (status: AgentStatus) => {
      if (!selectedAgent.statuses.includes(status) || status === selectedStatus) {
        return;
      }
      navigateToSelection({
        agentName: selectedAgent.name,
        agentStatus: status,
        executionBackend: currentExecutionBackend,
        remoteSessionId: currentRemoteSessionId || undefined,
      });
    },
    [
      currentExecutionBackend,
      currentRemoteSessionId,
      navigateToSelection,
      selectedAgent,
      selectedStatus,
    ],
  );

  const handleRuntimeSelect = useCallback(
    (mode: "default" | "remote") => {
      const executionBackend = mode === "remote" ? "remote" : undefined;
      navigateToSelection({
        agentName: selectedAgent.name,
        agentStatus: selectedStatus,
        executionBackend,
        remoteSessionId:
          executionBackend === "remote"
            ? currentRemoteSessionId || remoteDraft || undefined
            : undefined,
      });
    },
    [
      currentRemoteSessionId,
      navigateToSelection,
      remoteDraft,
      selectedAgent.name,
      selectedStatus,
    ],
  );

  const commitRemoteSession = useCallback(() => {
    const trimmed = remoteDraft.trim();
    navigateToSelection({
      agentName: selectedAgent.name,
      agentStatus: selectedStatus,
      executionBackend: "remote",
      remoteSessionId: trimmed || undefined,
    });
  }, [navigateToSelection, remoteDraft, selectedAgent.name, selectedStatus]);

  const handleRemoteKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      commitRemoteSession();
    },
    [commitRemoteSession],
  );

  const handleCopyLaunchURL = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${launchPath}`);
      toast.success("Agent launch URL copied");
    } catch {
      toast.error("Failed to copy launch URL");
    }
  }, [launchPath]);

  const handleAgentPick = useCallback(
    (agent: AgentDirectoryEntry) => {
      navigateToSelection({
        agentName: agent.name,
        agentStatus: normalizeStatus(currentStatus, agent.statuses),
        executionBackend: currentExecutionBackend,
        remoteSessionId: currentRemoteSessionId || undefined,
      });
      setPickerOpen(false);
    },
    [
      currentExecutionBackend,
      currentRemoteSessionId,
      currentStatus,
      navigateToSelection,
    ],
  );

  return (
    <>
      <SidebarGroup className="pt-0">
        <SidebarGroupLabel className="flex items-center justify-between px-1">
          <span>Agent Workspace</span>
          <span className="text-sidebar-foreground/45 text-[11px]">
            {groupedAgents.length}
          </span>
        </SidebarGroupLabel>
        <SidebarGroupAction asChild>
          <Link href="/workspace/agents/new" aria-label="Create agent">
            <PlusIcon />
          </Link>
        </SidebarGroupAction>
        <SidebarGroupContent className="group-data-[collapsible=icon]:hidden space-y-3">
          <div className="border-sidebar-border/70 from-sidebar-accent/55 to-sidebar/80 rounded-2xl border bg-linear-to-b p-3 shadow-xs">
            <div className="flex items-start gap-3">
              <div className="bg-sidebar-accent text-sidebar-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-2xl border border-white/40 shadow-xs">
                <BotIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">
                    {isLeadAgent(selectedAgent.name) ? "lead_agent" : selectedAgent.name}
                  </p>
                  {isLeadAgent(selectedAgent.name) && (
                    <Badge variant="outline" className="border-sidebar-border/70 text-[10px]">
                      core
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                  {selectedAgent.description ||
                    "Runtime, archive, and demo launch are managed from here."}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-sidebar-border/70 h-8 rounded-xl"
                onClick={() => setPickerOpen(true)}
              >
                <ArrowRightLeftIcon className="size-3.5" />
                Switch agent
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-sidebar-border/70 h-8 rounded-xl"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2Icon className="size-3.5" />
                Settings
              </Button>
            </div>

            <div className="text-sidebar-foreground/45 mt-2 text-right text-[11px]">
              {groupedAgents.length} available
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <div className="text-sidebar-foreground/55 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em]">
                  <BotIcon className="size-3.5" />
                  Archive
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["dev", "prod"] as AgentStatus[]).map((status) => {
                    const available = selectedAgent.statuses.includes(status);
                    const active = status === selectedStatus;
                    return (
                      <Button
                        key={status}
                        size="sm"
                        variant={active ? "secondary" : "ghost"}
                        className={cn(
                          "h-8 rounded-xl border text-xs capitalize",
                          active
                            ? "border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xs"
                            : "border-sidebar-border/60 text-sidebar-foreground/75 hover:bg-sidebar-accent/80",
                          !available && "opacity-35",
                        )}
                        disabled={!available}
                        onClick={() => handleStatusSelect(status)}
                      >
                        {status}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-sidebar-foreground/55 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em]">
                  <PlugZapIcon className="size-3.5" />
                  Runtime
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant={currentExecutionBackend === "remote" ? "ghost" : "secondary"}
                    className={cn(
                      "h-8 rounded-xl border text-xs",
                      currentExecutionBackend === "remote"
                        ? "border-sidebar-border/60 text-sidebar-foreground/75"
                        : "border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xs",
                    )}
                    onClick={() => handleRuntimeSelect("default")}
                  >
                    <LaptopIcon className="size-3.5" />
                    Local
                  </Button>
                  <Button
                    size="sm"
                    variant={currentExecutionBackend === "remote" ? "secondary" : "ghost"}
                    className={cn(
                      "h-8 rounded-xl border text-xs",
                      currentExecutionBackend === "remote"
                        ? "border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xs"
                        : "border-sidebar-border/60 text-sidebar-foreground/75",
                    )}
                    onClick={() => handleRuntimeSelect("remote")}
                  >
                    <PlugZapIcon className="size-3.5" />
                    Remote
                  </Button>
                </div>
              </div>

              {currentExecutionBackend === "remote" && (
                <div className="space-y-1.5">
                  <div className="text-sidebar-foreground/55 text-[11px] font-medium uppercase tracking-[0.18em]">
                    Remote Session
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={remoteDraft}
                      onChange={(event) => setRemoteDraft(event.target.value)}
                      onBlur={commitRemoteSession}
                      onKeyDown={handleRemoteKeyDown}
                      placeholder="session id"
                      className="border-sidebar-border/70 bg-sidebar/70 h-8 rounded-xl text-xs"
                    />
                    <Button
                      size="icon-sm"
                      variant="outline"
                      className="border-sidebar-border/70 h-8 w-8 rounded-xl"
                      onClick={commitRemoteSession}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8 flex-1 rounded-xl" asChild>
                  <Link href={launchPath}>
                    <ExternalLinkIcon className="size-3.5" />
                    Open
                  </Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="border-sidebar-border/70 h-8 w-8 rounded-xl"
                  onClick={handleCopyLaunchURL}
                >
                  <CopyIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <CommandDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Switch agent"
        description="Search and switch to another agent workspace."
        className="max-w-[calc(100%-2rem)] sm:max-w-2xl"
      >
        <CommandInput placeholder="Search by agent name or description" />
        <CommandList className="max-h-[65vh] p-2">
          <CommandEmpty>No agent matches your search.</CommandEmpty>
          <CommandGroup heading={`Available agents (${groupedAgents.length})`}>
            {groupedAgents.map((agent) => {
              const isActive = selectedAgent.name === agent.name;
              const preferredStatus = normalizeStatus(currentStatus, agent.statuses);

              return (
                <CommandItem
                  key={agent.name}
                  value={`${agent.name} ${agent.description} ${agent.statuses.join(" ")}`}
                  className="rounded-2xl px-3 py-3"
                  onSelect={() => handleAgentPick(agent)}
                >
                  <div className="flex w-full items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl border",
                        isActive
                          ? "border-border bg-accent text-accent-foreground"
                          : "border-border/70 bg-background",
                      )}
                    >
                      {isActive ? (
                        <CheckIcon className="size-4" />
                      ) : (
                        <BotIcon className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {agent.name}
                        </span>
                        {isLeadAgent(agent.name) && (
                          <Badge variant="outline" className="text-[10px]">
                            core
                          </Badge>
                        )}
                        {isActive && (
                          <Badge variant="secondary" className="text-[10px]">
                            current
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                        {agent.description ||
                          `Available in ${agent.statuses.join(" / ")}`}
                      </p>
                    </div>
                    <div className="ml-auto flex gap-1 pt-0.5">
                      {agent.statuses.map((status) => (
                        <Badge
                          key={`${agent.name}-${status}`}
                          variant={status === preferredStatus ? "secondary" : "outline"}
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {status}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <AgentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        agentName={selectedAgent.name}
        agentStatus={selectedStatus}
        executionBackend={currentExecutionBackend}
        remoteSessionId={currentRemoteSessionId || undefined}
      />
    </>
  );
}
