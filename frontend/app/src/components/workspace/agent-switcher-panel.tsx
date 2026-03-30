import {
  BotIcon,
  CheckIcon,
  ExternalLinkIcon,
  LaptopIcon,
  PlugZapIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildWorkspaceAgentSettingsPath,
  buildWorkspaceAgentPath,
  groupAgentsByName,
  isLeadAgent,
  pickAgentStatus,
  readAgentRuntimeSelection,
  type AgentStatus,
  useAgents,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type AgentSelection = {
  agentName: string;
  agentStatus: AgentStatus;
  executionBackend?: "remote";
  remoteSessionId?: string;
};

const switcherSectionLabelClassName =
  "text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase";

export function AgentSwitcherPanel({
  onClose,
}: {
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeParams = useParams<{ agent_name?: string }>();
  const { agents, isLoading, error } = useAgents();
  const [remoteDraft, setRemoteDraft] = useState("");
  const [searchValue, setSearchValue] = useState("");

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
        description: t.agents.switcher.builtinDescription,
        statuses: ["dev", "prod"] satisfies AgentStatus[],
      },
    [groupedAgents, runtimeSelection.agentName, t.agents.switcher],
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
      void navigate(
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
    [onClose, navigate],
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

  const handleOpenAgentCenter = useCallback(() => {
    onClose?.();
    void navigate("/workspace/agents");
  }, [navigate, onClose]);

  const handleOpenAgentSettings = useCallback(() => {
    onClose?.();
    void navigate(buildWorkspaceAgentSettingsPath(currentSelection));
  }, [currentSelection, navigate, onClose]);

  return (
    <>
      <section>
        <header className="space-y-2">
          <div className="text-lg font-semibold">
            {t.agents.switcher.title}
          </div>
          <div className="text-muted-foreground text-sm">
            {t.agents.switcher.description}
          </div>
        </header>
        <div className="space-y-6">
          <section className="border-border/70 bg-background rounded-3xl border p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[11px] tracking-[0.18em]",
                    switcherSectionLabelClassName,
                  )}
                >
                  {t.agents.switcher.currentAgent}
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
                          {t.agents.coreBadge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm leading-6">
                      {selectedAgent.description ||
                        t.agents.switcher.currentAgentDescription}
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
                  {t.agents.chat}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenAgentSettings}
                >
                  <Settings2Icon className="size-3.5" />
                  {t.common.settings}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenAgentCenter}
                >
                  <BotIcon className="size-3.5" />
                  {t.sidebar.agents}
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,260px)_minmax(0,260px)_minmax(0,1fr)]">
              <div className="space-y-2">
                <p className={switcherSectionLabelClassName}>
                  {t.common.version}
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
                <p className={switcherSectionLabelClassName}>
                  {t.agents.switcher.execution}
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
                    {t.agents.switcher.defaultRuntime}
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
                    {t.agents.switcher.remoteRuntime}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className={switcherSectionLabelClassName}>
                  {t.agents.switcher.remoteSession}
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
                  placeholder={t.agents.switcher.remoteSessionPlaceholder}
                  className="h-9 rounded-2xl"
                  disabled={currentSelection.executionBackend !== "remote"}
                />
              </div>
            </div>
          </section>

          <section className="border-border/70 bg-background rounded-3xl border p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold">
                  {t.agents.switcher.chooseAnotherTitle}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t.agents.switcher.chooseAnotherDescription}
                </p>
              </div>
              <Badge variant="outline">
                {t.agents.switcher.total(groupedAgents.length)}
              </Badge>
            </div>

            <div className="relative mt-4">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={t.agents.switcher.searchPlaceholder}
                className="h-10 rounded-2xl pl-9"
              />
            </div>

            <ScrollArea className="mt-4 h-[min(48vh,420px)]">
              <div className="grid gap-3 pr-3">
                {isLoading ? (
                  <div className="text-muted-foreground rounded-3xl border border-dashed px-4 py-8 text-sm">
                    {t.agents.switcher.loading}
                  </div>
                ) : error ? (
                  <div className="rounded-3xl border border-dashed px-4 py-8 text-sm">
                    {error instanceof Error
                      ? error.message
                      : t.agents.switcher.loadError}
                  </div>
                ) : filteredAgents.length === 0 ? (
                  <div className="text-muted-foreground rounded-3xl border border-dashed px-4 py-8 text-sm">
                    {t.agents.switcher.empty}
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
                                  {t.agents.coreBadge}
                                </Badge>
                              )}
                              {isCurrent && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {t.agents.currentBadge}
                                </Badge>
                              )}
                            </div>
                            <p className="text-muted-foreground mt-1 text-sm leading-6">
                              {agent.description ||
                                t.agents.switcher.availableIn(
                                  agent.statuses.join(" / "),
                                )}
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
      </section>

    </>
  );
}
