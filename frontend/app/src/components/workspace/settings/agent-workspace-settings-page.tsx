"use client";

import {
  BotIcon,
  CheckIcon,
  ExternalLinkIcon,
  LaptopIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  PlugZapIcon,
} from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentSettingsDialog } from "@/components/workspace/agent-settings-dialog";
import {
  buildWorkspaceAgentPath,
  groupAgentsByName,
  isLeadAgent,
  pickAgentStatus,
  readAgentRuntimeSelection,
  type AgentStatus,
  useAgents,
} from "@/core/agents";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

type AgentSelection = {
  agentName: string;
  agentStatus: AgentStatus;
  executionBackend?: "remote";
  remoteSessionId?: string;
};

export function AgentWorkspaceSettingsPage({
  onClose,
}: {
  onClose?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeParams = useParams<{ agent_name?: string }>();
  const { agents, isLoading, error } = useAgents();
  const [remoteDraft, setRemoteDraft] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);

  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, routeParams.agent_name),
    [routeParams.agent_name, searchParams],
  );
  const groupedAgents = useMemo(() => groupAgentsByName(agents), [agents]);
  const deferredSearch = useDeferredValue(searchValue);

  const selectedAgent = useMemo(
    () =>
      groupedAgents.find(
        (agent) => agent.name === runtimeSelection.agentName,
      ) ??
      groupedAgents[0] ?? {
        name: "lead_agent",
        description: "Built-in orchestration agent",
        statuses: ["dev", "prod"] satisfies AgentStatus[],
      },
    [groupedAgents, runtimeSelection.agentName],
  );
  const selectedStatus = pickAgentStatus(
    runtimeSelection.agentStatus,
    selectedAgent.statuses,
  );
  const currentSelection: AgentSelection = useMemo(
    () => ({
      agentName: selectedAgent.name,
      agentStatus: selectedStatus,
      executionBackend: runtimeSelection.executionBackend,
      remoteSessionId: runtimeSelection.remoteSessionId || undefined,
    }),
    [
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
      selectedAgent.name,
      selectedStatus,
    ],
  );

  const filteredAgents = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return groupedAgents;
    }
    return groupedAgents.filter((agent) => {
      const haystack =
        `${agent.name} ${agent.description} ${agent.statuses.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredSearch, groupedAgents]);

  useEffect(() => {
    setRemoteDraft(runtimeSelection.remoteSessionId);
  }, [runtimeSelection.remoteSessionId]);

  const navigateToSelection = useCallback(
    (selection: AgentSelection) => {
      onClose?.();
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
    [onClose, router],
  );

  const handleStatusSelect = useCallback(
    (status: AgentStatus) => {
      if (
        !selectedAgent.statuses.includes(status) ||
        status === selectedStatus
      ) {
        return;
      }
      navigateToSelection({
        ...currentSelection,
        agentStatus: status,
      });
    },
    [
      currentSelection,
      navigateToSelection,
      selectedAgent.statuses,
      selectedStatus,
    ],
  );

  const handleRuntimeSelect = useCallback(
    (mode: "default" | "remote") => {
      const trimmedRemoteDraft = remoteDraft.trim();
      const nextRemoteSessionId =
        currentSelection.remoteSessionId?.trim() ??
        (trimmedRemoteDraft.length > 0 ? trimmedRemoteDraft : undefined);
      navigateToSelection({
        ...currentSelection,
        executionBackend: mode === "remote" ? "remote" : undefined,
        remoteSessionId: mode === "remote" ? nextRemoteSessionId : undefined,
      });
    },
    [currentSelection, navigateToSelection, remoteDraft],
  );

  const commitRemoteSession = useCallback(() => {
    navigateToSelection({
      ...currentSelection,
      executionBackend: "remote",
      remoteSessionId: remoteDraft.trim() || undefined,
    });
  }, [currentSelection, navigateToSelection, remoteDraft]);

  const handleAgentPick = useCallback(
    (agentName: string, statuses: AgentStatus[]) => {
      navigateToSelection({
        agentName,
        agentStatus: pickAgentStatus(runtimeSelection.agentStatus, statuses),
        executionBackend: currentSelection.executionBackend,
        remoteSessionId: currentSelection.remoteSessionId ?? undefined,
      });
    },
    [
      currentSelection.executionBackend,
      currentSelection.remoteSessionId,
      navigateToSelection,
      runtimeSelection.agentStatus,
    ],
  );

  const handleCreateAgent = useCallback(() => {
    onClose?.();
    router.push("/workspace/agents/new");
  }, [onClose, router]);

  return (
    <>
      <SettingsSection
        title="Agent Workspace"
        description="Switch agents, archive versions, and runtime from one simpler settings view."
      >
        <div className="space-y-6">
          <section className="border-border/70 bg-background rounded-3xl border p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                  Current agent
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-2xl">
                    <BotIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">
                        {isLeadAgent(selectedAgent.name)
                          ? "lead_agent"
                          : selectedAgent.name}
                      </h3>
                      {isLeadAgent(selectedAgent.name) && (
                        <Badge variant="outline" className="text-[10px]">
                          core
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm leading-6">
                      {selectedAgent.description ||
                        "The active archive and runtime are managed here."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => navigateToSelection(currentSelection)}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open chat
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAgentSettingsOpen(true)}
                >
                  <Settings2Icon className="size-3.5" />
                  Archive settings
                </Button>
                <Button size="sm" variant="outline" onClick={handleCreateAgent}>
                  <PlusIcon className="size-3.5" />
                  Create agent
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,260px)_minmax(0,260px)_minmax(0,1fr)]">
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                  Archive
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["dev", "prod"] as AgentStatus[]).map((status) => {
                    const available = selectedAgent.statuses.includes(status);
                    const active = status === selectedStatus;
                    return (
                      <Button
                        key={status}
                        size="sm"
                        variant={active ? "secondary" : "outline"}
                        disabled={!available}
                        className="h-9 rounded-2xl capitalize"
                        onClick={() => handleStatusSelect(status)}
                      >
                        {status}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                  Runtime
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant={
                      currentSelection.executionBackend === "remote"
                        ? "outline"
                        : "secondary"
                    }
                    className="h-9 rounded-2xl"
                    onClick={() => handleRuntimeSelect("default")}
                  >
                    <LaptopIcon className="size-3.5" />
                    Default
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      currentSelection.executionBackend === "remote"
                        ? "secondary"
                        : "outline"
                    }
                    className="h-9 rounded-2xl"
                    onClick={() => handleRuntimeSelect("remote")}
                  >
                    <PlugZapIcon className="size-3.5" />
                    Remote
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                  Session
                </p>
                <Input
                  value={remoteDraft}
                  onChange={(event) => setRemoteDraft(event.target.value)}
                  onBlur={() => {
                    if (currentSelection.executionBackend === "remote") {
                      commitRemoteSession();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      currentSelection.executionBackend === "remote"
                    ) {
                      event.preventDefault();
                      commitRemoteSession();
                    }
                  }}
                  placeholder="remote session id"
                  className="h-9 rounded-2xl"
                  disabled={currentSelection.executionBackend !== "remote"}
                />
              </div>
            </div>
          </section>

          <section className="border-border/70 bg-background rounded-3xl border p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold">Agent search</p>
                <p className="text-muted-foreground text-sm">
                  Find an agent by name or description, then switch with one
                  click.
                </p>
              </div>
              <Badge variant="outline">{groupedAgents.length} total</Badge>
            </div>

            <div className="relative mt-4">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search agents"
                className="h-10 rounded-2xl pl-9"
              />
            </div>

            <ScrollArea className="mt-4 h-[min(48vh,420px)]">
              <div className="grid gap-3 pr-3">
                {isLoading ? (
                  <div className="text-muted-foreground rounded-3xl border border-dashed px-4 py-8 text-sm">
                    Loading agents...
                  </div>
                ) : error ? (
                  <div className="rounded-3xl border border-dashed px-4 py-8 text-sm">
                    {error instanceof Error
                      ? error.message
                      : "Failed to load agents"}
                  </div>
                ) : filteredAgents.length === 0 ? (
                  <div className="text-muted-foreground rounded-3xl border border-dashed px-4 py-8 text-sm">
                    No agents match this search.
                  </div>
                ) : (
                  filteredAgents.map((agent) => {
                    const isCurrent = agent.name === selectedAgent.name;
                    const preferredStatus = pickAgentStatus(
                      runtimeSelection.agentStatus,
                      agent.statuses,
                    );

                    return (
                      <button
                        key={agent.name}
                        type="button"
                        onClick={() =>
                          handleAgentPick(agent.name, agent.statuses)
                        }
                        className={cn(
                          "border-border/70 hover:border-border hover:bg-muted/30 rounded-3xl border px-4 py-4 text-left transition-colors",
                          isCurrent && "border-primary/35 bg-primary/5",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl border",
                              isCurrent
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border/70 bg-background text-muted-foreground",
                            )}
                          >
                            {isCurrent ? (
                              <CheckIcon className="size-4" />
                            ) : (
                              <BotIcon className="size-4" />
                            )}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {agent.name}
                              </p>
                              {isLeadAgent(agent.name) && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  core
                                </Badge>
                              )}
                              {isCurrent && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  current
                                </Badge>
                              )}
                            </div>
                            <p className="text-muted-foreground mt-1 text-sm leading-6">
                              {agent.description ||
                                `Available in ${agent.statuses.join(" / ")}`}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {agent.statuses.map((status) => (
                              <Badge
                                key={`${agent.name}-${status}`}
                                variant={
                                  status === preferredStatus
                                    ? "secondary"
                                    : "outline"
                                }
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {status}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </section>
        </div>
      </SettingsSection>

      <AgentSettingsDialog
        open={agentSettingsOpen}
        onOpenChange={setAgentSettingsOpen}
        agentName={currentSelection.agentName}
        agentStatus={currentSelection.agentStatus}
        executionBackend={currentSelection.executionBackend}
        remoteSessionId={currentSelection.remoteSessionId}
      />
    </>
  );
}
