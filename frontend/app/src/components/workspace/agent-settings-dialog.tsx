"use client";

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
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useSkills } from "@/core/skills/hooks";
import {
  filterSkillsByScope,
  formatSkillScopeLabel,
  getAllowedSkillScopesForAgent,
  getDuplicateSkillNames,
  normalizeSkillScope,
  type SkillScope,
} from "@/core/skills/scope";
import type { Skill } from "@/core/skills/type";
import { cn } from "@/lib/utils";

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

function skillRefKey(skillRef: AgentSkillRef) {
  return `${skillRef.category ?? "uncategorized"}:${skillRef.name}`;
}

function buildSkillSourcePath(skill: Skill) {
  const scope = normalizeSkillScope(skill.category) ?? "shared";
  return `${scope}/${skill.name}`;
}

function createSkillRef(skill: Skill): AgentSkillRef {
  const category = normalizeSkillScope(skill.category) ?? "shared";
  return {
    name: skill.name,
    category,
    source_path: buildSkillSourcePath(skill),
    materialized_path: `skills/${skill.name}`,
  };
}

function parseIntegerInput(value: string, label: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  return parsed;
}

function parseFloatInput(value: string, label: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
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
  } = useAgentExportDoc(open && isProdArchive ? agentName : null, open && isProdArchive);
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
    () =>
      getAllowedSkillScopesForAgent(agentStatus, allowSharedSkillSelection),
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
      toast.error("Failed to copy text");
    }
  }

  async function handleCopyLaunchURL() {
    await handleCopyText(launchURL, "Agent launch URL copied");
  }

  async function handleDownloadReactDemo() {
    try {
      const filename = await downloadDemoMutation.mutateAsync(agentName);
      toast.success(`${filename} downloaded`);
    } catch (downloadError) {
      toast.error(
        downloadError instanceof Error
          ? downloadError.message
          : "Failed to download React demo",
      );
    }
  }

  async function handleSave() {
    if (!form) {
      return;
    }

    try {
      if (form.memoryEnabled && !form.memoryModel.trim()) {
        throw new Error("Memory model is required when memory is enabled.");
      }

      const updated = await updateAgentMutation.mutateAsync({
        name: agentName,
        status: agentStatus,
        request: {
          description: form.description.trim(),
          model: form.model.trim() ? form.model.trim() : null,
          tool_groups: parseCSV(form.toolGroups),
          mcp_servers: parseCSV(form.mcpServers),
          skill_refs: form.skillRefs,
          agents_md: form.agentsMd,
          memory: {
            enabled: form.memoryEnabled,
            model_name: form.memoryModel.trim()
              ? form.memoryModel.trim()
              : null,
            debounce_seconds: parseIntegerInput(
              form.debounceSeconds,
              "Debounce seconds",
            ),
            max_facts: parseIntegerInput(form.maxFacts, "Max facts"),
            fact_confidence_threshold: parseFloatInput(
              form.confidenceThreshold,
              "Confidence threshold",
            ),
            injection_enabled: form.injectionEnabled,
            max_injection_tokens: parseIntegerInput(
              form.maxInjectionTokens,
              "Max injection tokens",
            ),
          },
        },
      });

      const nextForm = createFormState(updated);
      setForm(nextForm);
      setSavedForm(nextForm);
      toast.success(`${updated.name} (${updated.status}) saved`);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save agent settings",
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
      label: "Profile",
      icon: <BotIcon className="size-4" />,
    },
    {
      value: "skills",
      label: "Skills",
      icon: <SparklesIcon className="size-4" />,
    },
    {
      value: "prompt",
      label: "Prompt",
      icon: <FileTextIcon className="size-4" />,
    },
    {
      value: "config",
      label: "Config",
      icon: <SlidersHorizontalIcon className="size-4" />,
    },
    {
      value: "access",
      label: "Access",
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
                  Agent Settings
                </div>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                  <span className="truncate">{agentName}</span>
                  <Badge variant="outline" className="capitalize">
                    {agentStatus}
                  </Badge>
                  {executionBackend === "remote" && (
                    <Badge variant="secondary">remote cli</Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-3xl text-sm leading-6">
                  Edit the archived agent profile, its private `AGENTS.md`, and
                  the structured config that becomes `config.yaml`.
                </DialogDescription>
              </div>
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <Button size="sm" variant="outline" asChild>
                  <Link href={launchPath}>
                    <ExternalLinkIcon className="size-3.5" />
                    Open workspace
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyLaunchURL}
                >
                  <CopyIcon className="size-3.5" />
                  Copy URL
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
                    Loading archived agent settings...
                  </div>
                ) : error ? (
                  <div className="flex min-h-[420px] items-center justify-center">
                    <SurfaceCard
                      eyebrow={<BotIcon className="size-4" />}
                      title="Archive unavailable"
                      description="The selected archived agent could not be loaded from the gateway."
                    >
                      <p className="text-sm leading-6">
                        {error instanceof Error
                          ? error.message
                          : "Unknown error"}
                      </p>
                    </SurfaceCard>
                  </div>
                ) : !agent || !form ? (
                  <div className="text-muted-foreground flex min-h-[420px] items-center justify-center text-sm">
                    Select an agent archive to configure.
                  </div>
                ) : (
                  <>
                    <TabsContent value="profile" className="m-0 space-y-6">
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_320px]">
                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<BotIcon className="size-4" />}
                            title="Identity"
                            description="Define how this archived agent should be described and targeted."
                          >
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <FieldLabel>Agent name</FieldLabel>
                                <div className="bg-muted/35 border-border/70 flex h-11 items-center rounded-2xl border px-3 text-sm font-medium">
                                  {agent.name}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <FieldLabel>Model override</FieldLabel>
                                <Input
                                  value={form.model}
                                  placeholder="Optional model id"
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
                              <FieldLabel>Description</FieldLabel>
                              <Textarea
                                value={form.description}
                                placeholder="Summarize what this agent owns and what it should optimize for."
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
                            title="Capabilities"
                            description="Keep the fast controls here; skill authoring still belongs to the create-agent flow."
                          >
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <FieldLabel>Tool groups</FieldLabel>
                                <Textarea
                                  value={form.toolGroups}
                                  placeholder="browser, filesystem, office"
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
                                  Comma separated. Leave blank to keep the
                                  current unrestricted default.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <FieldLabel>MCP servers</FieldLabel>
                                <Textarea
                                  value={form.mcpServers}
                                  placeholder="notion, github, slack"
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
                                  Comma separated. These values are stored in
                                  the archived manifest.
                                </p>
                              </div>
                            </div>
                          </SurfaceCard>
                        </div>

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<SparklesIcon className="size-4" />}
                            title="Archive context"
                            description="A quick read on the currently loaded agent archive."
                          >
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="capitalize">
                                {agent.status}
                              </Badge>
                              {agent.model && (
                                <Badge variant="secondary">{agent.model}</Badge>
                              )}
                              <Badge variant="outline">
                                {skillNames.length} copied skill
                                {skillNames.length === 1 ? "" : "s"}
                              </Badge>
                            </div>

                            {isLeadAgent(agent.name) && (
                              <p className="text-muted-foreground border-border/70 bg-muted/25 rounded-2xl border px-4 py-3 text-xs leading-6">
                                `lead_agent` stays the built-in orchestration
                                entrypoint. The generic system prompt remains in
                                backend code; this dialog edits only the
                                archived lead-agent-owned prompt and config.
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
                                  No copied skills are attached to this archive.
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
                          title="Copied skills"
                          description={
                            allowSharedSkillSelection
                              ? "Attach archived skills from shared, dev, or prod stores to this agent archive."
                              : agentStatus === "prod"
                                ? "Prod archives can only attach skills from the prod store."
                                : "Dev archives can attach skills from dev and prod stores, but duplicate names across both stores are blocked."
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
                                  {formatSkillScopeLabel(category)}
                                </Button>
                              );
                            })}
                          </div>

                          {skillsLoading ? (
                            <div className="text-muted-foreground flex items-center gap-2 text-sm">
                              <Loader2Icon className="size-4 animate-spin" />
                              Loading skill catalog...
                            </div>
                          ) : skillsError ? (
                            <div className="text-sm">
                              {skillsError instanceof Error
                                ? skillsError.message
                                : "Failed to load skills"}
                            </div>
                          ) : filteredSkills.length === 0 ? (
                            <div className="text-muted-foreground text-sm">
                              No skills are available in this archive scope.
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
                                          {skill.description}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        {!skill.enabled && (
                                          <Badge variant="outline">
                                            disabled
                                          </Badge>
                                        )}
                                        {selected && (
                                          <Badge variant="secondary">
                                            <CheckIcon className="size-3.5" />
                                            attached
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
                                Hidden duplicate names across `store/dev` and
                                `store/prod`:{" "}
                                {[...duplicateSkillNames].sort().join(", ")}
                              </div>
                            )}
                        </SurfaceCard>

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<Settings2Icon className="size-4" />}
                            title="Selected archive skills"
                            description="These copied skills are written into the archive's `skills/` directory on save."
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
                                        )}`
                                      : ""}
                                    <span className="text-[10px] uppercase tracking-[0.12em]">
                                      remove
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <p className="text-muted-foreground text-sm">
                                  No copied skills selected for this archive.
                                </p>
                              )}
                            </div>
                          </SurfaceCard>

                          <SurfaceCard
                            eyebrow={<Link2Icon className="size-4" />}
                            title="Selection rules"
                            description="Skill sources stay in the shared archives; this dialog only decides what gets copied into this agent."
                          >
                            {allowSharedSkillSelection ? (
                              <p className="text-muted-foreground text-sm leading-6">
                                `lead_agent` may still use `shared` building
                                blocks. Other archived agents should prefer the
                                dev/prod stores.
                              </p>
                            ) : agentStatus === "prod" ? (
                              <p className="text-muted-foreground text-sm leading-6">
                                Prod archives must use `store/prod` skills. If
                                a dev-only skill is still attached, publish that
                                skill to prod before publishing the agent.
                              </p>
                            ) : (
                              <p className="text-muted-foreground text-sm leading-6">
                                Dev archives may use both `store/dev` and
                                `store/prod`, but names that exist in both
                                stores are intentionally blocked to avoid
                                ambiguous selection.
                              </p>
                            )}
                          </SurfaceCard>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="prompt" className="m-0 space-y-6">
                      <SurfaceCard
                        eyebrow={<FileTextIcon className="size-4" />}
                        title="Archived AGENTS.md"
                        description="This prompt lives with the agent archive and is materialized into the runtime copy for each thread."
                      >
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                          <div className="space-y-2">
                            <FieldLabel>Prompt body</FieldLabel>
                            <Textarea
                              value={form.agentsMd}
                              placeholder="Write the agent-owned instructions here."
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
                                Runtime contract
                              </FieldLabel>
                              <p className="text-sm leading-6">
                                The archived prompt is copied into:
                              </p>
                              <code className="bg-background border-border/70 mt-3 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                                /mnt/user-data/agents/{agent.status}/
                                {agent.name}/AGENTS.md
                              </code>
                            </div>
                            <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                              <FieldLabel className="mb-2">
                                Editing scope
                              </FieldLabel>
                              <p className="text-muted-foreground text-sm leading-6">
                                Keep the generic orchestrator rules in backend
                                code. Put only agent-owned domain behavior,
                                decomposition guidance, and skill usage policy
                                in this file.
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
                          title="Memory capture"
                          description="Structure the archived memory policy instead of editing raw YAML."
                        >
                          <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">
                                Enable memory
                              </p>
                              <p className="text-muted-foreground text-xs leading-5">
                                User-scoped memory is stored per agent archive.
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
                              <FieldLabel>Memory model</FieldLabel>
                              <Input
                                value={form.memoryModel}
                                placeholder="Required when memory is enabled"
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
                              <FieldLabel>Debounce seconds</FieldLabel>
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
                              <FieldLabel>Max facts</FieldLabel>
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
                              <FieldLabel>Confidence threshold</FieldLabel>
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
                          title="Prompt injection"
                          description="These controls map directly onto the archived config manifest."
                        >
                          <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">
                                Enable memory injection
                              </p>
                              <p className="text-muted-foreground text-xs leading-5">
                                Inject retrieved memory back into the runtime
                                prompt.
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
                            <FieldLabel>Max injection tokens</FieldLabel>
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
                              Why no raw YAML?
                            </FieldLabel>
                            <p className="text-muted-foreground text-sm leading-6">
                              `config.yaml` remains the archived manifest, but
                              this workspace uses structured controls so the
                              common settings stay legible and harder to break.
                            </p>
                          </div>
                        </SurfaceCard>
                      </div>
                    </TabsContent>

                    <TabsContent value="access" className="m-0 space-y-6">
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                        <SurfaceCard
                          eyebrow={<Link2Icon className="size-4" />}
                          title="Launch surface"
                          description="Use the exact current archive and runtime selection when sharing or testing."
                        >
                          <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                            <FieldLabel className="mb-2">Launch URL</FieldLabel>
                            <code className="bg-background border-border/70 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
                              {launchURL}
                            </code>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button asChild>
                              <Link href={launchPath}>
                                <ExternalLinkIcon className="size-3.5" />
                                Open workspace
                              </Link>
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleCopyLaunchURL}
                            >
                              <CopyIcon className="size-3.5" />
                              Copy URL
                            </Button>
                          </div>
                        </SurfaceCard>

                        {isProdArchive ? (
                          <SurfaceCard
                            eyebrow={<DownloadIcon className="size-4" />}
                            title="Open API export"
                            description="Published prod agents can be invoked outside the platform and exported as a local React demo."
                          >
                            {exportDocLoading ? (
                              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                <Loader2Icon className="size-4 animate-spin" />
                                Loading export document...
                              </div>
                            ) : exportDocError ? (
                              <p className="text-sm leading-6">
                                {exportDocError instanceof Error
                                  ? exportDocError.message
                                  : "Failed to load export document."}
                              </p>
                            ) : exportDoc ? (
                              <div className="space-y-4">
                                <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
                                  <FieldLabel className="mb-2">
                                    Gateway base
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
                                        "Chat endpoint copied",
                                      )
                                    }
                                  >
                                    <CopyIcon className="size-3.5" />
                                    Copy chat endpoint
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      handleCopyText(
                                        exportDoc.endpoints.stream.url,
                                        "Stream endpoint copied",
                                      )
                                    }
                                  >
                                    <CopyIcon className="size-3.5" />
                                    Copy stream endpoint
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
                                    Download React demo
                                  </Button>
                                </div>

                                <div className="space-y-2">
                                  <FieldLabel>Demo notes</FieldLabel>
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
                            title="Open API export"
                            description="External invocation and demo download are only available after publishing this agent to prod."
                          >
                            <p className="text-muted-foreground text-sm leading-6">
                              Publish this archive first if you want a stable
                              `/open/v1/agents/{agentName}` endpoint or a
                              downloadable React demo bundle for local testing.
                            </p>
                          </SurfaceCard>
                        )}

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<FileTextIcon className="size-4" />}
                            title="Archive assets"
                            description="A compact map of what this settings dialog can control today."
                          >
                            <div className="space-y-3">
                              <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    AGENTS.md
                                  </p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    Editable from the Prompt tab.
                                  </p>
                                </div>
                                <Badge variant="secondary">editable</Badge>
                              </div>
                              <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    config.yaml
                                  </p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    Managed from the Config tab.
                                  </p>
                                </div>
                                <Badge variant="outline">structured</Badge>
                              </div>
                              <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">skills/</p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    Current copied skills are shown in Profile.
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
                            title="Export behavior"
                            description="What the current export workflow does when you download the React demo."
                          >
                            <p className="text-muted-foreground text-sm leading-6">
                              The download action calls the protected gateway
                              export endpoint, creates a short-lived API token,
                              and writes the resolved base URL, agent name, and
                              token into the generated Vite project so the demo
                              can run outside this platform.
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
                {isDirty ? "Unsaved archive changes" : "Archive is up to date"}
              </p>
              <p className="text-muted-foreground text-xs leading-5">
                Save applies to the currently selected {agentStatus} archive
                only.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                disabled={!isDirty || !form || updateAgentMutation.isPending}
                onClick={handleReset}
              >
                Reset
              </Button>
              <Button
                disabled={!isDirty || !form || updateAgentMutation.isPending}
                onClick={handleSave}
              >
                {updateAgentMutation.isPending && (
                  <Loader2Icon className="size-4 animate-spin" />
                )}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
