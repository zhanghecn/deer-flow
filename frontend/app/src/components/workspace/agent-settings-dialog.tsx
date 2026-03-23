import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Link2Icon,
  Loader2Icon,
  Settings2Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  buildWorkspaceAgentPath,
  isLeadAgent,
  type Agent,
  type AgentStatus,
  useAgent,
  useAgentExportDoc,
  useDownloadAgentReactDemo,
  useUpdateAgent,
} from "@/core/agents";
import type { AgentSkillRef } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { getLocalizedSkillDescription } from "@/core/skills";
import { useSkills } from "@/core/skills/hooks";
import {
  filterSkillsByScope,
  formatSkillScopeLabel,
  getAllowedSkillScopesForAgent,
  getDuplicateSkillNames,
  normalizeSkillScope,
  type SkillScope,
} from "@/core/skills/scope";
import { cn } from "@/lib/utils";

import {
  createSkillRef,
  serializeSkillRefForRequest,
  skillRefKey,
} from "./agent-skill-refs";
import { getAgentSettingsDialogText } from "./agent-settings-dialog.i18n";

type SettingsTab = "profile" | "skills" | "prompt" | "config" | "access";

type AgentSettingsFormState = {
  description: string;
  model: string;
  toolGroups: string;
  mcpServers: string;
  skillRefs: AgentSkillRef[];
  agentsMd: string;
  memoryEnabled: boolean;
  memoryModel: string;
  debounceSeconds: string;
  maxFacts: string;
  confidenceThreshold: string;
  injectionEnabled: boolean;
  maxInjectionTokens: string;
};

interface AgentSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  agentStatus: AgentStatus;
  executionBackend?: "remote";
  remoteSessionId?: string;
}

function toCSV(values: string[] | null | undefined) {
  return (values ?? []).join(", ");
}

function parseCSV(value: string) {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function createFormState(agent: Agent): AgentSettingsFormState {
  return {
    description: agent.description ?? "",
    model: agent.model ?? "",
    toolGroups: toCSV(agent.tool_groups),
    mcpServers: toCSV(agent.mcp_servers),
    skillRefs: agent.skills ?? [],
    agentsMd: agent.agents_md ?? "",
    memoryEnabled: agent.memory?.enabled ?? false,
    memoryModel: agent.memory?.model_name ?? "",
    debounceSeconds: String(agent.memory?.debounce_seconds ?? 30),
    maxFacts: String(agent.memory?.max_facts ?? 100),
    confidenceThreshold: String(agent.memory?.fact_confidence_threshold ?? 0.7),
    injectionEnabled: agent.memory?.injection_enabled ?? true,
    maxInjectionTokens: String(agent.memory?.max_injection_tokens ?? 2000),
  };
}

function parseIntegerInput(
  value: string,
  label: string,
  formatError: (label: string) => string,
) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(formatError(label));
  }
  return parsed;
}

function parseFloatInput(
  value: string,
  label: string,
  formatError: (label: string) => string,
) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(formatError(label));
  }
  return parsed;
}

function FieldLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

function SurfaceCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border/70 bg-background/95 rounded-3xl border p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground border-border/70 bg-muted/35 flex size-8 items-center justify-center rounded-2xl border">
          {eyebrow}
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-5">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

export function AgentSettingsDialog({
  open,
  onOpenChange,
  agentName,
  agentStatus,
  executionBackend,
  remoteSessionId,
}: AgentSettingsDialogProps) {
  const { locale } = useI18n();
  const text = getAgentSettingsDialogText(locale);
  const { agent, isLoading, error } = useAgent(
    open ? agentName : null,
    agentStatus,
  );
  const {
    skills: availableSkills,
    isLoading: skillsLoading,
    error: skillsError,
  } = useSkills();
  const isProdArchive = agentStatus === "prod";
  const {
    exportDoc,
    isLoading: exportDocLoading,
    error: exportDocError,
  } = useAgentExportDoc(
    open && isProdArchive ? agentName : null,
    open && isProdArchive,
  );
  const downloadDemoMutation = useDownloadAgentReactDemo();
  const updateAgentMutation = useUpdateAgent();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [form, setForm] = useState<AgentSettingsFormState | null>(null);
  const [savedForm, setSavedForm] = useState<AgentSettingsFormState | null>(
    null,
  );
  const [skillsCategory, setSkillsCategory] = useState<SkillScope>("shared");
  const allowSharedSkillSelection = isLeadAgent(agentName);

  const launchPath = useMemo(
    () =>
      buildWorkspaceAgentPath({
        agentName,
        agentStatus,
        executionBackend,
        remoteSessionId,
      }),
    [agentName, agentStatus, executionBackend, remoteSessionId],
  );

  const launchURL = useMemo(() => {
    if (typeof window === "undefined") {
      return launchPath;
    }
    return `${window.location.origin}${launchPath}`;
  }, [launchPath]);

  const skillNames = useMemo(
    () =>
      (form?.skillRefs ?? agent?.skills ?? [])
        .map((skill) => skill.name)
        .filter(Boolean),
    [agent?.skills, form?.skillRefs],
  );
  const allowedSkillScopes = useMemo(
    () => getAllowedSkillScopesForAgent(agentStatus, allowSharedSkillSelection),
    [agentStatus, allowSharedSkillSelection],
  );
  const duplicateSkillNames = useMemo(
    () => getDuplicateSkillNames(availableSkills, allowedSkillScopes),
    [allowedSkillScopes, availableSkills],
  );
  const selectableSkills = useMemo(
    () =>
      availableSkills.filter((skill) => {
        const scope = normalizeSkillScope(skill.category);
        if (!scope || !allowedSkillScopes.includes(scope)) {
          return false;
        }
        if (
          !allowSharedSkillSelection &&
          agentStatus === "dev" &&
          duplicateSkillNames.has(skill.name)
        ) {
          return false;
        }
        return true;
      }),
    [
      agentStatus,
      allowSharedSkillSelection,
      allowedSkillScopes,
      availableSkills,
      duplicateSkillNames,
    ],
  );
  const availableSkillCategories = useMemo(
    () =>
      allowedSkillScopes.filter((scope) =>
        selectableSkills.some(
          (skill) => normalizeSkillScope(skill.category) === scope,
        ),
      ),
    [allowedSkillScopes, selectableSkills],
  );
  const filteredSkills = useMemo(
    () => filterSkillsByScope(selectableSkills, skillsCategory),
    [selectableSkills, skillsCategory],
  );

  const isDirty = useMemo(() => {
    if (!form || !savedForm) {
      return false;
    }
    return JSON.stringify(form) !== JSON.stringify(savedForm);
  }, [form, savedForm]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveTab("profile");
    setSkillsCategory("shared");
  }, [agentName, agentStatus, open]);

  useEffect(() => {
    if (
      availableSkillCategories.length > 0 &&
      !availableSkillCategories.includes(skillsCategory)
    ) {
      setSkillsCategory(availableSkillCategories[0]!);
    }
  }, [availableSkillCategories, skillsCategory]);

  useEffect(() => {
    if (!open || !agent) {
      return;
    }
    const nextForm = createFormState(agent);
    setForm(nextForm);
    setSavedForm(nextForm);
  }, [agent, open]);

  async function handleCopyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(text.copyFailed);
    }
  }

  async function handleCopyLaunchURL() {
    await handleCopyText(launchURL, text.launchUrlCopied);
  }

  async function handleDownloadReactDemo() {
    try {
      const filename = await downloadDemoMutation.mutateAsync(agentName);
      toast.success(text.downloadSuccess(filename));
    } catch (downloadError) {
      toast.error(
        downloadError instanceof Error
          ? downloadError.message
          : text.downloadFailed,
      );
    }
  }

  async function handleSave() {
    if (!form) {
      return;
    }

    try {
      if (form.memoryEnabled && !form.memoryModel.trim()) {
        throw new Error(text.memoryModelRequired);
      }

      const updated = await updateAgentMutation.mutateAsync({
        name: agentName,
        status: agentStatus,
        request: {
          description: form.description.trim(),
          model: form.model.trim() ? form.model.trim() : null,
          tool_groups: parseCSV(form.toolGroups),
          mcp_servers: parseCSV(form.mcpServers),
          skill_refs: form.skillRefs.map(serializeSkillRefForRequest),
          agents_md: form.agentsMd,
          memory: {
            enabled: form.memoryEnabled,
            model_name: form.memoryModel.trim()
              ? form.memoryModel.trim()
              : null,
            debounce_seconds: parseIntegerInput(
              form.debounceSeconds,
              text.debounceSeconds,
              text.mustBeInteger,
            ),
            max_facts: parseIntegerInput(
              form.maxFacts,
              text.maxFacts,
              text.mustBeInteger,
            ),
            fact_confidence_threshold: parseFloatInput(
              form.confidenceThreshold,
              text.confidenceThreshold,
              text.mustBeNumber,
            ),
            injection_enabled: form.injectionEnabled,
            max_injection_tokens: parseIntegerInput(
              form.maxInjectionTokens,
              text.maxInjectionTokens,
              text.mustBeInteger,
            ),
          },
        },
      });

      const nextForm = createFormState(updated);
      setForm(nextForm);
      setSavedForm(nextForm);
      toast.success(text.saveSuccess(updated.name, updated.status));
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : text.saveFailed,
      );
    }
  }

  function handleReset() {
    if (!savedForm) {
      return;
    }
    setForm(savedForm);
  }

  const tabItems: Array<{
    value: SettingsTab;
    label: string;
    icon: ReactNode;
  }> = [
    {
      value: "profile",
      label: text.tabs.profile,
      icon: <BotIcon className="size-4" />,
    },
    {
      value: "skills",
      label: text.tabs.skills,
      icon: <SparklesIcon className="size-4" />,
    },
    {
      value: "prompt",
      label: text.tabs.prompt,
      icon: <FileTextIcon className="size-4" />,
    },
    {
      value: "config",
      label: text.tabs.config,
      icon: <SlidersHorizontalIcon className="size-4" />,
    },
    {
      value: "access",
      label: text.tabs.access,
      icon: <Link2Icon className="size-4" />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-border/70 bg-background flex h-[88vh] max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden p-0 shadow-2xl sm:max-w-6xl"
        aria-describedby={undefined}
      >
        <div className="border-border/70 border-b px-6 py-5">
          <DialogHeader className="text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-muted-foreground mb-3 flex items-center gap-2 text-[11px] font-medium tracking-[0.22em] uppercase">
                  <Settings2Icon className="size-3.5" />
                  {text.headerEyebrow}
                </div>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                  <span className="truncate">{agentName}</span>
                  <Badge variant="outline" className="capitalize">
                    {agentStatus}
                  </Badge>
                  {executionBackend === "remote" && (
                    <Badge variant="secondary">{text.remoteCliBadge}</Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-3xl text-sm leading-6">
                  {text.headerDescription}
                </DialogDescription>
              </div>
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <Button size="sm" variant="outline" asChild>
                  <Link to={launchPath}>
                    <ExternalLinkIcon className="size-3.5" />
                    {text.openWorkspace}
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyLaunchURL}
                >
                  <CopyIcon className="size-3.5" />
                  {text.copyUrl}
                </Button>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          orientation="vertical"
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-border/70 border-b px-4 py-3 md:hidden">
            <TabsList
              variant="line"
              className="w-full justify-start gap-1 overflow-x-auto bg-transparent p-0"
            >
              {tabItems.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="rounded-xl border px-3 py-2"
                >
                  {tab.icon}
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <aside className="bg-sidebar/30 border-border/70 hidden w-[220px] shrink-0 border-r md:block">
            <div className="p-3">
              <TabsList
                variant="line"
                className="h-auto w-full flex-col bg-transparent p-0"
              >
                {tabItems.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="w-full justify-start gap-3 rounded-2xl border px-3 py-2.5"
                  >
                    {tab.icon}
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-4 md:p-6">
                {isLoading ? (
                  <div className="text-muted-foreground flex min-h-[420px] items-center justify-center gap-2 text-sm">
                    <Loader2Icon className="size-4 animate-spin" />
                    {text.loading}
                  </div>
                ) : error ? (
                  <div className="flex min-h-[420px] items-center justify-center">
                    <SurfaceCard
                      eyebrow={<BotIcon className="size-4" />}
                      title={text.loadErrorTitle}
                      description={text.loadErrorDescription}
                    >
                      <p className="text-sm leading-6">
                        {error instanceof Error
                          ? error.message
                          : text.unknownError}
                      </p>
                    </SurfaceCard>
                  </div>
                ) : !agent || !form ? (
                  <div className="text-muted-foreground flex min-h-[420px] items-center justify-center text-sm">
                    {text.selectArchive}
                  </div>
                ) : (
                  <>
                    <TabsContent value="profile" className="m-0 space-y-6">
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_320px]">
                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<BotIcon className="size-4" />}
                            title={text.identityTitle}
                            description={text.identityDescription}
                          >
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <FieldLabel>{text.agentName}</FieldLabel>
                                <div className="bg-muted/35 border-border/70 flex h-11 items-center rounded-2xl border px-3 text-sm font-medium">
                                  {agent.name}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <FieldLabel>{text.modelOverride}</FieldLabel>
                                <Input
                                  value={form.model}
                                  placeholder={text.optionalModelId}
                                  onChange={(event) =>
                                    setForm((current) =>
                                      current
                                        ? {
                                            ...current,
                                            model: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  className="h-11 rounded-2xl"
                                />
                              </div>
                            </div>

                            <div className="space-y-2">
                              <FieldLabel>{text.description}</FieldLabel>
                              <Textarea
                                value={form.description}
                                placeholder={text.descriptionPlaceholder}
                                onChange={(event) =>
                                  setForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          description: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="min-h-28 rounded-3xl px-4 py-3 text-sm leading-6"
                              />
                            </div>
                          </SurfaceCard>

                          <SurfaceCard
                            eyebrow={<SparklesIcon className="size-4" />}
                            title={text.capabilitiesTitle}
                            description={text.capabilitiesDescription}
                          >
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <FieldLabel>{text.toolGroups}</FieldLabel>
                                <Textarea
                                  value={form.toolGroups}
                                  placeholder={text.toolGroupsPlaceholder}
                                  onChange={(event) =>
                                    setForm((current) =>
                                      current
                                        ? {
                                            ...current,
                                            toolGroups: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  className="min-h-24 rounded-3xl px-4 py-3 text-sm leading-6"
                                />
                                <p className="text-muted-foreground text-xs leading-5">
                                  {text.toolGroupsHint}
                                </p>
                              </div>
                              <div className="space-y-2">
                                <FieldLabel>{text.mcpServers}</FieldLabel>
                                <Textarea
                                  value={form.mcpServers}
                                  placeholder={text.mcpServersPlaceholder}
                                  onChange={(event) =>
                                    setForm((current) =>
                                      current
                                        ? {
                                            ...current,
                                            mcpServers: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  className="min-h-24 rounded-3xl px-4 py-3 text-sm leading-6"
                                />
                                <p className="text-muted-foreground text-xs leading-5">
                                  {text.mcpServersHint}
                                </p>
                              </div>
                            </div>
                          </SurfaceCard>
                        </div>

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<SparklesIcon className="size-4" />}
                            title={text.archiveContextTitle}
                            description={text.archiveContextDescription}
                          >
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="capitalize">
                                {agent.status}
                              </Badge>
                              {agent.model && (
                                <Badge variant="secondary">{agent.model}</Badge>
                              )}
                              <Badge variant="outline">
                                {text.copiedSkillsCount(skillNames.length)}
                              </Badge>
                            </div>

                            {isLeadAgent(agent.name) && (
                              <p className="text-muted-foreground border-border/70 bg-muted/25 rounded-2xl border px-4 py-3 text-xs leading-6">
                                {text.leadAgentArchiveNote}
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2">
                              {skillNames.length > 0 ? (
                                skillNames.map((skillName) => (
                                  <Badge
                                    key={skillName}
                                    variant="secondary"
                                    className="rounded-full px-2.5 py-1 text-xs"
                                  >
                                    {skillName}
                                  </Badge>
                                ))
                              ) : (
                                <p className="text-muted-foreground text-sm">
                                  {text.noCopiedSkillsAttached}
                                </p>
                              )}
                            </div>
                          </SurfaceCard>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="skills" className="m-0 space-y-6">
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px]">
                        <SurfaceCard
                          eyebrow={<SparklesIcon className="size-4" />}
                          title={text.copiedSkillsTitle}
                          description={
                            allowSharedSkillSelection
                              ? text.copiedSkillsDescriptionShared
                              : agentStatus === "prod"
                                ? text.copiedSkillsDescriptionProd
                                : text.copiedSkillsDescriptionDev
                          }
                        >
                          <div className="flex flex-wrap gap-2">
                            {availableSkillCategories.map((category) => {
                              const active = category === skillsCategory;
                              return (
                                <Button
                                  key={category}
                                  variant={active ? "secondary" : "outline"}
                                  className="rounded-full"
                                  onClick={() => setSkillsCategory(category)}
                                >
                                  {formatSkillScopeLabel(category, locale)}
                                </Button>
                              );
                            })}
                          </div>

                          {skillsLoading ? (
                            <div className="text-muted-foreground flex items-center gap-2 text-sm">
                              <Loader2Icon className="size-4 animate-spin" />
                              {text.loadingSkills}
                            </div>
                          ) : skillsError ? (
                            <div className="text-sm">
                              {skillsError instanceof Error
                                ? skillsError.message
                                : text.loadSkillsFailed}
                            </div>
                          ) : filteredSkills.length === 0 ? (
                            <div className="text-muted-foreground text-sm">
                              {text.noSkillsInScope}
                            </div>
                          ) : (
                            <div className="grid gap-3">
                              {filteredSkills.map((skill) => {
                                const nextRef = createSkillRef(skill);
                                const selected = form.skillRefs.some(
                                  (skillRef) =>
                                    skillRefKey(skillRef) ===
                                    skillRefKey(nextRef),
                                );

                                return (
                                  <button
                                    key={skillRefKey(nextRef)}
                                    type="button"
                                    onClick={() =>
                                      setForm((current) => {
                                        if (!current) {
                                          return current;
                                        }

                                        const exists = current.skillRefs.some(
                                          (skillRef) =>
                                            skillRefKey(skillRef) ===
                                            skillRefKey(nextRef),
                                        );
                                        if (exists) {
                                          return {
                                            ...current,
                                            skillRefs: current.skillRefs.filter(
                                              (skillRef) =>
                                                skillRefKey(skillRef) !==
                                                skillRefKey(nextRef),
                                            ),
                                          };
                                        }

                                        return {
                                          ...current,
                                          skillRefs: [
                                            ...current.skillRefs,
                                            nextRef,
                                          ],
                                        };
                                      })
                                    }
                                    className={cn(
                                      "rounded-3xl border p-4 text-left transition-colors",
                                      selected
                                        ? "border-primary/50 bg-primary/5"
                                        : "border-border/70 bg-background/70 hover:bg-muted/30",
                                    )}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium">
                                          {skill.name}
                                        </p>
                                        <p className="text-muted-foreground mt-1 text-xs leading-5">
                                          {getLocalizedSkillDescription(
                                            skill,
                                            locale,
                                          )}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        {!skill.enabled && (
                                          <Badge variant="outline">
                                            {text.disabledBadge}
                                          </Badge>
                                        )}
                                        {selected && (
                                          <Badge variant="secondary">
                                            <CheckIcon className="size-3.5" />
                                            {text.attachedBadge}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {!allowSharedSkillSelection &&
                            agentStatus === "dev" &&
                            duplicateSkillNames.size > 0 && (
                              <div className="text-muted-foreground border-border/70 bg-muted/25 rounded-2xl border px-4 py-3 text-xs leading-6">
                                {text.hiddenDuplicateNames(
                                  [...duplicateSkillNames].sort().join(", "),
                                )}
                              </div>
                            )}
                        </SurfaceCard>

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<Settings2Icon className="size-4" />}
                            title={text.selectedSkillsTitle}
                            description={text.selectedSkillsDescription}
                          >
                            <div className="flex flex-wrap gap-2">
                              {form.skillRefs.length > 0 ? (
                                form.skillRefs.map((skillRef) => (
                                  <button
                                    key={skillRefKey(skillRef)}
                                    type="button"
                                    className="bg-secondary text-secondary-foreground inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
                                    onClick={() =>
                                      setForm((current) =>
                                        current
                                          ? {
                                              ...current,
                                              skillRefs:
                                                current.skillRefs.filter(
                                                  (item) =>
                                                    skillRefKey(item) !==
                                                    skillRefKey(skillRef),
                                                ),
                                            }
                                          : current,
                                      )
                                    }
                                  >
                                    {skillRef.name}
                                    {normalizeSkillScope(skillRef.category)
                                      ? ` · ${formatSkillScopeLabel(
                                          normalizeSkillScope(
                                            skillRef.category,
                                          )!,
                                          locale,
                                        )}`
                                      : ""}
                                    <span className="text-[10px] tracking-[0.12em] uppercase">
                                      {text.remove}
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <p className="text-muted-foreground text-sm">
                                  {text.noSelectedSkills}
                                </p>
                              )}
                            </div>
                          </SurfaceCard>

                          <SurfaceCard
                            eyebrow={<Link2Icon className="size-4" />}
                            title={text.selectionRulesTitle}
                            description={text.selectionRulesDescription}
                          >
                            {allowSharedSkillSelection ? (
                              <p className="text-muted-foreground text-sm leading-6">
                                {text.selectionRulesLeadAgent}
                              </p>
                            ) : agentStatus === "prod" ? (
                              <p className="text-muted-foreground text-sm leading-6">
                                {text.selectionRulesProd}
                              </p>
                            ) : (
                              <p className="text-muted-foreground text-sm leading-6">
                                {text.selectionRulesDev}
                              </p>
                            )}
                          </SurfaceCard>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="prompt" className="m-0 space-y-6">
                      <SurfaceCard
                        eyebrow={<FileTextIcon className="size-4" />}
                        title={text.promptTitle}
                        description={text.promptDescription}
                      >
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                          <div className="space-y-2">
                            <FieldLabel>{text.promptBody}</FieldLabel>
                            <Textarea
                              value={form.agentsMd}
                              placeholder={text.promptPlaceholder}
                              onChange={(event) =>
                                setForm((current) =>
                                  current
                                    ? {
                                        ...current,
                                        agentsMd: event.target.value,
                                      }
                                    : current,
                                )
                              }
                              className="border-border/70 bg-muted/10 min-h-[440px] rounded-3xl px-4 py-4 font-mono text-[13px] leading-6"
                            />
                          </div>

                          <div className="space-y-4">
                            <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                              <FieldLabel className="mb-2">
                                {text.runtimeContract}
                              </FieldLabel>
                              <p className="text-sm leading-6">{text.runtimeContractIntro}</p>
                              <code className="bg-background border-border/70 mt-3 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                                /mnt/user-data/agents/{agent.status}/
                                {agent.name}/AGENTS.md
                              </code>
                            </div>
                            <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                              <FieldLabel className="mb-2">
                                {text.editingScope}
                              </FieldLabel>
                              <p className="text-muted-foreground text-sm leading-6">
                                {text.editingScopeDescription}
                              </p>
                            </div>
                          </div>
                        </div>
                      </SurfaceCard>
                    </TabsContent>

                    <TabsContent value="config" className="m-0 space-y-6">
                      <div className="grid gap-6 xl:grid-cols-2">
                        <SurfaceCard
                          eyebrow={<BrainIcon className="size-4" />}
                          title={text.memoryTitle}
                          description={text.memoryDescription}
                        >
                          <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">{text.enableMemory}</p>
                              <p className="text-muted-foreground text-xs leading-5">
                                {text.enableMemoryDescription}
                              </p>
                            </div>
                            <Switch
                              checked={form.memoryEnabled}
                              onCheckedChange={(checked) =>
                                setForm((current) =>
                                  current
                                    ? { ...current, memoryEnabled: checked }
                                    : current,
                                )
                              }
                            />
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                              <FieldLabel>{text.memoryModel}</FieldLabel>
                              <Input
                                value={form.memoryModel}
                                placeholder={text.memoryModelPlaceholder}
                                disabled={!form.memoryEnabled}
                                onChange={(event) =>
                                  setForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          memoryModel: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-11 rounded-2xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <FieldLabel>{text.debounceSeconds}</FieldLabel>
                              <Input
                                type="number"
                                min={1}
                                max={300}
                                value={form.debounceSeconds}
                                onChange={(event) =>
                                  setForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          debounceSeconds: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-11 rounded-2xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <FieldLabel>{text.maxFacts}</FieldLabel>
                              <Input
                                type="number"
                                min={10}
                                max={500}
                                value={form.maxFacts}
                                onChange={(event) =>
                                  setForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          maxFacts: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-11 rounded-2xl"
                              />
                            </div>
                            <div className="space-y-2">
                              <FieldLabel>{text.confidenceThreshold}</FieldLabel>
                              <Input
                                type="number"
                                min={0}
                                max={1}
                                step="0.01"
                                value={form.confidenceThreshold}
                                onChange={(event) =>
                                  setForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          confidenceThreshold:
                                            event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-11 rounded-2xl"
                              />
                            </div>
                          </div>
                        </SurfaceCard>

                        <SurfaceCard
                          eyebrow={<SlidersHorizontalIcon className="size-4" />}
                          title={text.promptInjectionTitle}
                          description={text.promptInjectionDescription}
                        >
                          <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">
                                {text.enableMemoryInjection}
                              </p>
                              <p className="text-muted-foreground text-xs leading-5">
                                {text.enableMemoryInjectionDescription}
                              </p>
                            </div>
                            <Switch
                              checked={form.injectionEnabled}
                              onCheckedChange={(checked) =>
                                setForm((current) =>
                                  current
                                    ? { ...current, injectionEnabled: checked }
                                    : current,
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <FieldLabel>{text.maxInjectionTokens}</FieldLabel>
                            <Input
                              type="number"
                              min={100}
                              max={8000}
                              value={form.maxInjectionTokens}
                              onChange={(event) =>
                                setForm((current) =>
                                  current
                                    ? {
                                        ...current,
                                        maxInjectionTokens: event.target.value,
                                      }
                                    : current,
                                )
                              }
                              className="h-11 rounded-2xl"
                            />
                          </div>

                          <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                            <FieldLabel className="mb-2">
                              {text.whyNoRawYaml}
                            </FieldLabel>
                            <p className="text-muted-foreground text-sm leading-6">
                              {text.whyNoRawYamlDescription}
                            </p>
                          </div>
                        </SurfaceCard>
                      </div>
                    </TabsContent>

                    <TabsContent value="access" className="m-0 space-y-6">
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                        <SurfaceCard
                          eyebrow={<Link2Icon className="size-4" />}
                          title={text.launchSurfaceTitle}
                          description={text.launchSurfaceDescription}
                        >
                          <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                            <FieldLabel className="mb-2">{text.launchUrl}</FieldLabel>
                            <code className="bg-background border-border/70 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                              {launchURL}
                            </code>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button asChild>
                              <Link to={launchPath}>
                                <ExternalLinkIcon className="size-3.5" />
                                {text.openWorkspace}
                              </Link>
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleCopyLaunchURL}
                            >
                              <CopyIcon className="size-3.5" />
                              {text.copyUrl}
                            </Button>
                          </div>
                        </SurfaceCard>

                        {isProdArchive ? (
                          <SurfaceCard
                            eyebrow={<DownloadIcon className="size-4" />}
                            title={text.openApiExportTitle}
                            description={text.openApiExportDescription}
                          >
                            {exportDocLoading ? (
                              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                <Loader2Icon className="size-4 animate-spin" />
                                {text.loadingExportDocument}
                              </div>
                            ) : exportDocError ? (
                              <p className="text-sm leading-6">
                                {exportDocError instanceof Error
                                  ? exportDocError.message
                                  : text.loadExportDocumentFailed}
                              </p>
                            ) : exportDoc ? (
                              <div className="space-y-4">
                                <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                                  <FieldLabel className="mb-2">
                                    {text.gatewayBase}
                                  </FieldLabel>
                                  <code className="bg-background border-border/70 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                                    {exportDoc.api_base_url}
                                  </code>
                                </div>

                                {(
                                  [
                                    ["chat", exportDoc.endpoints.chat],
                                    ["stream", exportDoc.endpoints.stream],
                                  ] as const
                                ).map(([endpointName, endpoint]) => (
                                  <div
                                    key={endpointName}
                                    className="border-border/70 rounded-3xl border p-4"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="secondary">
                                        {endpoint.method}
                                      </Badge>
                                      <p className="text-sm font-medium capitalize">
                                        {endpointName}
                                      </p>
                                    </div>
                                    <code className="bg-background border-border/70 mt-3 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                                      {endpoint.url}
                                    </code>
                                  </div>
                                ))}

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      handleCopyText(
                                        exportDoc.endpoints.chat.url,
                                        text.chatEndpointCopied,
                                      )
                                    }
                                  >
                                    <CopyIcon className="size-3.5" />
                                    {text.copyChatEndpoint}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      handleCopyText(
                                        exportDoc.endpoints.stream.url,
                                        text.streamEndpointCopied,
                                      )
                                    }
                                  >
                                    <CopyIcon className="size-3.5" />
                                    {text.copyStreamEndpoint}
                                  </Button>
                                  <Button
                                    onClick={handleDownloadReactDemo}
                                    disabled={downloadDemoMutation.isPending}
                                  >
                                    {downloadDemoMutation.isPending && (
                                      <Loader2Icon className="size-3.5 animate-spin" />
                                    )}
                                    {!downloadDemoMutation.isPending && (
                                      <DownloadIcon className="size-3.5" />
                                    )}
                                    {text.downloadReactDemo}
                                  </Button>
                                </div>

                                <div className="space-y-2">
                                  <FieldLabel>{text.demoNotes}</FieldLabel>
                                  <div className="space-y-2">
                                    {exportDoc.demo.notes.map((note) => (
                                      <p
                                        key={note}
                                        className="text-muted-foreground rounded-2xl border px-4 py-3 text-sm leading-6"
                                      >
                                        {note}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </SurfaceCard>
                        ) : (
                          <SurfaceCard
                            eyebrow={<Link2Icon className="size-4" />}
                            title={text.openApiExportTitle}
                            description={
                              text.openApiExportUnavailableDescription
                            }
                          >
                            <p className="text-muted-foreground text-sm leading-6">
                              {text.publishArchiveFirst}
                            </p>
                          </SurfaceCard>
                        )}

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<FileTextIcon className="size-4" />}
                            title={text.archiveAssetsTitle}
                            description={text.archiveAssetsDescription}
                          >
                            <div className="space-y-3">
                              <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    {text.agentsMd}
                                  </p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    {text.agentsMdDescription}
                                  </p>
                                </div>
                                <Badge variant="secondary">{text.editableBadge}</Badge>
                              </div>
                              <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    {text.configYaml}
                                  </p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    {text.configYamlDescription}
                                  </p>
                                </div>
                                <Badge variant="outline">
                                  {text.structuredBadge}
                                </Badge>
                              </div>
                              <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    {text.skillsDirectory}
                                  </p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    {text.skillsDirectoryDescription}
                                  </p>
                                </div>
                                <Badge variant="outline">
                                  {skillNames.length}
                                </Badge>
                              </div>
                            </div>
                          </SurfaceCard>

                          <SurfaceCard
                            eyebrow={<Settings2Icon className="size-4" />}
                            title={text.exportBehaviorTitle}
                            description={text.exportBehaviorDescription}
                          >
                            <p className="text-muted-foreground text-sm leading-6">
                              {text.exportBehaviorBody}
                            </p>
                          </SurfaceCard>
                        </div>
                      </div>
                    </TabsContent>
                  </>
                )}
              </div>
            </ScrollArea>
          </div>
        </Tabs>

        <div className="border-border/70 bg-background/95 border-t px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                {isDirty ? text.dirtyState : text.cleanState}
              </p>
              <p className="text-muted-foreground text-xs leading-5">
                {text.saveAppliesTo(agentStatus)}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                disabled={!isDirty || !form || updateAgentMutation.isPending}
                onClick={handleReset}
              >
                {text.reset}
              </Button>
              <Button
                disabled={!isDirty || !form || updateAgentMutation.isPending}
                onClick={handleSave}
              >
                {updateAgentMutation.isPending && (
                  <Loader2Icon className="size-4 animate-spin" />
                )}
                {text.saveChanges}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
