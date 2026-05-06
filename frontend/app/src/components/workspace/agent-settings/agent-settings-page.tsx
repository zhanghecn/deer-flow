import {
  ArrowLeftIcon,
  BotIcon,
  BrainIcon,
  Link2Icon,
  Loader2Icon,
  SaveIcon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type Agent,
  type AgentRuntimeMiddlewares,
  type AgentStatus,
  useAgent,
  useAgentExportDoc,
  useToolCatalog,
  useUpdateAgent,
} from "@/core/agents";
import { useAuth } from "@/core/auth/hooks";
import { overwriteStoredAgentAuthoringDraft } from "@/core/authoring";
import { useI18n } from "@/core/i18n/hooks";
import { useKnowledgeLibrary } from "@/core/knowledge/hooks";
import { useMCPProfiles } from "@/core/mcp/hooks";
import { useModels } from "@/core/models/hooks";
import { useSkills } from "@/core/skills/hooks";
import { cn } from "@/lib/utils";

import { serializeSkillRefForRequest } from "../agent-skill-refs";
import { resolveEffectiveToolNames } from "../agent-tool-selection";

import { BehaviorTab } from "./behavior-tab";
import { CapabilitiesTab } from "./capabilities-tab";
import { getAgentSettingsPageText, type AgentSettingsPageText } from "./i18n";
import { IdentityTab } from "./identity-tab";
import { IntegrationTab } from "./integration-tab";
import type { AgentSettingsFormState, SettingsTab } from "./types";

interface AgentSettingsPageProps {
  agentName: string;
  agentStatus: AgentStatus;
  executionBackend?: "remote";
}

function parseCSV(value: string) {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function parseIntegerInput(value: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${value} is not a valid integer`);
  }
  return parsed;
}

function parseFloatInput(value: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`${value} is not a valid number`);
  }
  return parsed;
}

function normalizeRuntimeMiddlewares(
  runtimeMiddlewares: AgentRuntimeMiddlewares | null | undefined,
): AgentRuntimeMiddlewares {
  const disabled = runtimeMiddlewares?.disabled ?? [];
  return {
    disabled: [...new Set(disabled.map((name) => name.trim()).filter(Boolean))],
  };
}

function createFormState(agent: Agent): AgentSettingsFormState {
  return {
    description: agent.description ?? "",
    model: agent.model ?? "",
    toolGroups: (agent.tool_groups ?? []).join(", "),
    toolSelectionEnabled: agent.tool_names != null,
    toolNames: agent.tool_names ?? [],
    runtimeMiddlewares: normalizeRuntimeMiddlewares(agent.runtime_middlewares),
    mcpServers: agent.mcp_servers ?? [],
    knowledgeBaseIds: agent.knowledge_base_ids ?? [],
    skillRefs: agent.skills ?? [],
    agentsMd: agent.agents_md ?? "",
    memoryEnabled: agent.memory?.enabled ?? false,
    memoryModel: agent.memory?.model_name ?? "",
    debounceSeconds: String(agent.memory?.debounce_seconds ?? 30),
    maxFacts: String(agent.memory?.max_facts ?? 100),
    confidenceThreshold: String(agent.memory?.fact_confidence_threshold ?? 0.7),
    injectionEnabled: agent.memory?.injection_enabled ?? true,
    maxInjectionTokens: String(agent.memory?.max_injection_tokens ?? 2000),
    generalPurposeEnabled:
      agent.subagent_defaults?.general_purpose_enabled ?? true,
    generalPurposeUsesMainTools: agent.subagent_defaults?.tool_names == null,
    generalPurposeToolNames: agent.subagent_defaults?.tool_names ?? [],
    subagents: (agent.subagents ?? []).map((sub, idx) => ({
      id: sub.name || `saved-subagent-${idx}`,
      name: sub.name,
      description: sub.description,
      systemPrompt: sub.system_prompt,
      model: sub.model ?? "",
      toolSelectionEnabled: sub.tool_names != null,
      toolNames: sub.tool_names ?? [],
      enabled: sub.enabled,
    })),
  };
}

function buildNavItems(text: AgentSettingsPageText) {
  return [
    {
      value: "identity" as const,
      label: text.tabIdentity,
      icon: <BotIcon className="size-4" />,
    },
    {
      value: "capabilities" as const,
      label: text.tabCapabilities,
      icon: <SparklesIcon className="size-4" />,
    },
    {
      value: "behavior" as const,
      label: text.tabBehavior,
      icon: <BrainIcon className="size-4" />,
    },
    {
      value: "integration" as const,
      label: text.tabIntegration,
      icon: <Link2Icon className="size-4" />,
    },
  ];
}

export function AgentSettingsPageView({
  agentName,
  agentStatus,
  executionBackend,
}: AgentSettingsPageProps) {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const text = getAgentSettingsPageText(locale);
  const { user } = useAuth();
  const { agent, isLoading, error } = useAgent(agentName, agentStatus);
  const canManage = agent?.can_manage !== false;

  const {
    skills: availableSkills,
    isLoading: skillsLoading,
    error: skillsError,
  } = useSkills();

  const {
    profiles: mcpProfiles,
    isLoading: mcpProfilesLoading,
    error: mcpProfilesError,
  } = useMCPProfiles();
  const {
    knowledgeBases,
    isLoading: knowledgeBasesLoading,
    error: knowledgeBasesError,
  } = useKnowledgeLibrary(undefined, { readyOnly: true });

  const canLoadExportDoc = agent != null;
  const { models, isLoading: modelsLoading, error: modelsError } = useModels();

  const {
    exportDoc,
    isLoading: exportDocLoading,
    error: exportDocError,
  } = useAgentExportDoc(canLoadExportDoc ? agentName : null, canLoadExportDoc);
  const exportDocMissing =
    exportDocError instanceof Error &&
    /agent not found/i.test(exportDocError.message);

  const {
    tools: toolCatalog,
    isLoading: toolCatalogLoading,
    error: toolCatalogError,
  } = useToolCatalog();

  const updateAgentMutation = useUpdateAgent();

  const [activeTab, setActiveTab] = useState<SettingsTab>("identity");
  const [form, setForm] = useState<AgentSettingsFormState | null>(null);
  const [savedForm, setSavedForm] = useState<AgentSettingsFormState | null>(
    null,
  );
  const [mcpProfileQuery, setMcpProfileQuery] = useState("");

  const mainToolOptions = useMemo(
    () =>
      toolCatalog.filter(
        (tool) =>
          tool.configurable_for_main_agent &&
          tool.reserved_policy !== "runtime_only",
      ),
    [toolCatalog],
  );

  const subagentToolOptions = useMemo(
    () =>
      toolCatalog.filter(
        (tool) =>
          tool.configurable_for_subagent && tool.reserved_policy === "normal",
      ),
    [toolCatalog],
  );

  const selectedMainToolNames = useMemo(
    () =>
      form
        ? resolveEffectiveToolNames(
            {
              toolSelectionEnabled: form.toolSelectionEnabled,
              toolNames: form.toolNames,
              toolGroups: form.toolGroups,
            },
            mainToolOptions,
            "main",
          )
        : [],
    [form, mainToolOptions],
  );

  const ownerLabel = useMemo(() => {
    if (!agent?.owner_user_id) return t.agents.legacyOwnerless;
    if (agent.owner_user_id === user?.id) return t.agents.ownedByYou;
    return agent.owner_name ?? agent.owner_user_id;
  }, [agent?.owner_name, agent?.owner_user_id, t, user?.id]);

  const skillNames = useMemo(
    () =>
      (form?.skillRefs ?? agent?.skills ?? [])
        .map((skill) => skill.name)
        .filter(Boolean),
    [agent?.skills, form?.skillRefs],
  );

  const isDirty = useMemo(() => {
    if (!form || !savedForm) return false;
    return JSON.stringify(form) !== JSON.stringify(savedForm);
  }, [form, savedForm]);

  useEffect(() => {
    if (!agent) return;
    const nextForm = createFormState(agent);
    setForm(nextForm);
    setSavedForm(nextForm);
  }, [agent]);

  function handleFormChange(
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) {
    setForm((current) => (current ? (updater(current) ?? current) : current));
  }

  async function handleSave() {
    if (!form) return;

    try {
      const normalizedSubagentNames = new Set<string>();
      const normalizedSubagents = form.subagents.map((subagent, index) => {
        const name = subagent.name.trim();
        if (!name) throw new Error(`Subagent ${index + 1}: name is required`);
        const lowered = name.toLowerCase();
        if (normalizedSubagentNames.has(lowered)) {
          throw new Error(`Duplicate subagent name: ${name}`);
        }
        normalizedSubagentNames.add(lowered);

        const description = subagent.description.trim();
        if (!description)
          throw new Error(`Subagent "${name}": description is required`);
        const systemPrompt = subagent.systemPrompt.trim();
        if (!systemPrompt)
          throw new Error(`Subagent "${name}": system prompt is required`);

        return {
          name,
          description,
          system_prompt: systemPrompt,
          model: subagent.model.trim() || null,
          tool_names: subagent.toolSelectionEnabled
            ? [...subagent.toolNames]
            : null,
          enabled: subagent.enabled,
        };
      });

      if (form.memoryEnabled && !form.memoryModel.trim()) {
        throw new Error("Memory model is required when memory is enabled");
      }

      const effectiveMainToolNames = resolveEffectiveToolNames(
        {
          toolSelectionEnabled: form.toolSelectionEnabled,
          toolNames: form.toolNames,
          toolGroups: form.toolGroups,
        },
        mainToolOptions,
        "main",
      );

      const updated = await updateAgentMutation.mutateAsync({
        name: agentName,
        status: agentStatus,
        request: {
          description: form.description.trim(),
          model: form.model.trim() || null,
          tool_groups: form.toolSelectionEnabled
            ? null
            : parseCSV(form.toolGroups),
          tool_names: form.toolSelectionEnabled
            ? [...effectiveMainToolNames]
            : null,
          runtime_middlewares: form.runtimeMiddlewares,
          mcp_servers: form.mcpServers.length > 0 ? [...form.mcpServers] : null,
          knowledge_base_ids: [...form.knowledgeBaseIds],
          skill_refs: form.skillRefs.map(serializeSkillRefForRequest),
          agents_md: form.agentsMd,
          subagent_defaults: {
            general_purpose_enabled: form.generalPurposeEnabled,
            tool_names: form.generalPurposeUsesMainTools
              ? null
              : [...form.generalPurposeToolNames],
          },
          subagents: normalizedSubagents,
          memory: {
            enabled: form.memoryEnabled,
            model_name: form.memoryModel.trim() || null,
            debounce_seconds: parseIntegerInput(form.debounceSeconds),
            max_facts: parseIntegerInput(form.maxFacts),
            fact_confidence_threshold: parseFloatInput(
              form.confidenceThreshold,
            ),
            injection_enabled: form.injectionEnabled,
            max_injection_tokens: parseIntegerInput(form.maxInjectionTokens),
          },
        },
      });

      const nextForm = createFormState(updated);
      setForm(nextForm);
      setSavedForm(nextForm);
      await overwriteStoredAgentAuthoringDraft(updated.name, updated.status);
      toast.success(text.saveSuccess(updated.name, updated.status));
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : text.saveFailed,
      );
    }
  }

  function handleReset() {
    if (savedForm) setForm(savedForm);
  }

  const launchPath = `/workspace/agents/${agentName}?agent_status=${agentStatus}`;

  const launchURL = useMemo(() => {
    if (typeof window === "undefined") return launchPath;
    return `${window.location.origin}${launchPath}`;
  }, [launchPath]);

  return (
    <div className="flex h-full flex-col">
      {/* Fixed Header */}
      <header className="border-border/70 bg-background/95 border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void navigate("/workspace/agents")}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{agentName}</h1>
              <Badge variant="outline" className="capitalize">
                {agentStatus}
              </Badge>
              {executionBackend === "remote" && (
                <Badge variant="secondary">Remote</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium">
                {isDirty ? text.unsavedChanges : text.allSaved}
              </p>
              <p className="text-muted-foreground text-xs">
                {canManage ? text.appliesToArchive(agentStatus) : text.readOnly}
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={!isDirty || !form || updateAgentMutation.isPending}
              onClick={handleReset}
            >
              {text.reset}
            </Button>
            <Button
              disabled={
                !canManage || !isDirty || !form || updateAgentMutation.isPending
              }
              onClick={handleSave}
            >
              {updateAgentMutation.isPending && (
                <Loader2Icon className="size-4 animate-spin" />
              )}
              <SaveIcon className="size-4" />
              {text.save}
            </Button>
          </div>
        </div>
      </header>

      {/* Body: Sidebar + Content */}
      <div className="min-h-0 flex-1">
        <div className="flex h-full">
          {/* Sidebar */}
          <aside className="bg-sidebar/30 border-border/70 w-[200px] shrink-0 border-r">
            <div className="p-3">
              <nav className="flex flex-col gap-1">
                {buildNavItems(text).map((item) => {
                  const active = item.value === activeTab;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setActiveTab(item.value)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm transition-colors",
                        active
                          ? "border-primary/50 bg-primary/5 font-medium"
                          : "text-muted-foreground hover:bg-muted/30 border-transparent",
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-6 lg:p-8">
                {isLoading ? (
                  <div className="text-muted-foreground flex min-h-[420px] items-center justify-center gap-2 text-sm">
                    <Loader2Icon className="size-4 animate-spin" />
                    {text.loading}
                  </div>
                ) : error ? (
                  <div className="flex min-h-[420px] items-center justify-center">
                    <p className="text-destructive text-sm">
                      {error instanceof Error ? error.message : text.loadError}
                    </p>
                  </div>
                ) : !agent || !form ? (
                  <div className="text-muted-foreground flex min-h-[420px] items-center justify-center text-sm">
                    {text.noAgent}
                  </div>
                ) : !canManage ? (
                  <div className="text-muted-foreground border-border/70 bg-background/95 rounded-3xl border p-5 text-sm">
                    <div className="flex items-center gap-2">
                      <Settings2Icon className="size-4" />
                      <span className="font-medium">
                        {text.restrictedTitle}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5">
                      {text.restrictedDescription}
                    </p>
                  </div>
                ) : (
                  <>
                    {activeTab === "identity" && (
                      <IdentityTab
                        agent={agent}
                        form={form}
                        agentStatus={agentStatus}
                        models={models}
                        modelsLoading={modelsLoading}
                        modelsError={modelsError}
                        selectedMainToolNames={selectedMainToolNames}
                        text={text}
                        onFormChange={handleFormChange}
                        onTabChange={setActiveTab}
                        ownerLabel={ownerLabel}
                        skillNames={skillNames}
                        mcpServerCount={form.mcpServers.length}
                      />
                    )}
                    {activeTab === "capabilities" && (
                      <CapabilitiesTab
                        form={form}
                        agentStatus={agentStatus}
                        models={models}
                        modelsLoading={modelsLoading}
                        modelsError={modelsError}
                        onFormChange={handleFormChange}
                        text={text}
                        availableSkills={availableSkills}
                        skillsLoading={skillsLoading}
                        skillsError={skillsError}
                        locale={locale}
                        mainToolOptions={mainToolOptions}
                        subagentToolOptions={subagentToolOptions}
                        selectedMainToolNames={selectedMainToolNames}
                        toolCatalogLoading={toolCatalogLoading}
                        toolCatalogError={toolCatalogError}
                        fullToolCatalog={toolCatalog}
                        mcpProfiles={mcpProfiles}
                        mcpProfilesLoading={mcpProfilesLoading}
                        mcpProfilesError={mcpProfilesError}
                        knowledgeBases={knowledgeBases}
                        knowledgeBasesLoading={knowledgeBasesLoading}
                        knowledgeBasesError={knowledgeBasesError}
                        mcpProfileQuery={mcpProfileQuery}
                        onMcpProfileQueryChange={setMcpProfileQuery}
                      />
                    )}
                    {activeTab === "behavior" && (
                      <BehaviorTab
                        agentName={agentName}
                        agentStatus={agentStatus}
                        form={form}
                        models={models}
                        modelsLoading={modelsLoading}
                        modelsError={modelsError}
                        skillNames={skillNames}
                        text={text}
                        onFormChange={handleFormChange}
                      />
                    )}
                    {activeTab === "integration" && (
                      <IntegrationTab
                        agentStatus={agentStatus}
                        launchPath={launchPath}
                        launchURL={launchURL}
                        executionBackend={executionBackend}
                        exportDoc={exportDoc}
                        exportDocLoading={exportDocLoading}
                        exportDocError={exportDocError}
                        exportDocMissing={exportDocMissing}
                        isProdArchive={agentStatus === "prod"}
                        text={text}
                      />
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
