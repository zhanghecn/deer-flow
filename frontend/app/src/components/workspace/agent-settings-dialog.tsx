"use client";

import {
  BotIcon,
  BrainIcon,
  CopyIcon,
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
  useUpdateAgent,
} from "@/core/agents";
import { cn } from "@/lib/utils";

type SettingsTab = "profile" | "prompt" | "config" | "access";

type AgentSettingsFormState = {
  description: string;
  model: string;
  toolGroups: string;
  mcpServers: string;
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
        "text-muted-foreground text-[11px] font-medium uppercase tracking-[0.18em]",
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
    <section className="rounded-3xl border border-border/70 bg-background/95 p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground flex size-8 items-center justify-center rounded-2xl border border-border/70 bg-muted/35">
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
  const { agent, isLoading, error } = useAgent(open ? agentName : null, agentStatus);
  const updateAgentMutation = useUpdateAgent();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [form, setForm] = useState<AgentSettingsFormState | null>(null);
  const [savedForm, setSavedForm] = useState<AgentSettingsFormState | null>(null);

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
    () => agent?.skills?.map((skill) => skill.name).filter(Boolean) ?? [],
    [agent?.skills],
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
  }, [agentName, agentStatus, open]);

  useEffect(() => {
    if (!open || !agent) {
      return;
    }
    const nextForm = createFormState(agent);
    setForm(nextForm);
    setSavedForm(nextForm);
  }, [agent, open]);

  async function handleCopyLaunchURL() {
    try {
      await navigator.clipboard.writeText(launchURL);
      toast.success("Agent launch URL copied");
    } catch {
      toast.error("Failed to copy launch URL");
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
        className="flex h-[88vh] max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden border-border/70 bg-background p-0 shadow-2xl sm:max-w-6xl"
        aria-describedby={undefined}
      >
        <div className="border-b border-border/70 px-6 py-5">
          <DialogHeader className="text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-muted-foreground mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em]">
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
                <Button size="sm" variant="outline" onClick={handleCopyLaunchURL}>
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
          <div className="border-b border-border/70 px-4 py-3 md:hidden">
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

          <aside className="bg-sidebar/30 hidden w-[220px] shrink-0 border-r border-border/70 md:block">
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
                        {error instanceof Error ? error.message : "Unknown error"}
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
                                <div className="bg-muted/35 flex h-11 items-center rounded-2xl border border-border/70 px-3 text-sm font-medium">
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
                                        ? { ...current, model: event.target.value }
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
                                  Comma separated. Leave blank to keep the current
                                  unrestricted default.
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
                                  Comma separated. These values are stored in the
                                  archived manifest.
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
                              <p className="text-muted-foreground rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-xs leading-6">
                                `lead_agent` stays the built-in orchestration
                                entrypoint. The generic system prompt remains in
                                backend code; this dialog edits only the archived
                                lead-agent-owned prompt and config.
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
                              className="min-h-[440px] rounded-3xl border-border/70 bg-muted/10 px-4 py-4 font-mono text-[13px] leading-6"
                            />
                          </div>

                          <div className="space-y-4">
                            <div className="rounded-3xl border border-border/70 bg-muted/20 p-4">
                              <FieldLabel className="mb-2">Runtime contract</FieldLabel>
                              <p className="text-sm leading-6">
                                The archived prompt is copied into:
                              </p>
                              <code className="bg-background mt-3 block rounded-2xl border border-border/70 px-3 py-3 text-xs leading-6 break-all">
                                /mnt/user-data/agents/{agent.status}/{agent.name}/AGENTS.md
                              </code>
                            </div>
                            <div className="rounded-3xl border border-border/70 bg-muted/20 p-4">
                              <FieldLabel className="mb-2">Editing scope</FieldLabel>
                              <p className="text-muted-foreground text-sm leading-6">
                                Keep the generic orchestrator rules in backend
                                code. Put only agent-owned domain behavior,
                                decomposition guidance, and skill usage policy in
                                this file.
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
                          <div className="bg-muted/20 flex items-center justify-between rounded-3xl border border-border/70 px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">Enable memory</p>
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
                          <div className="bg-muted/20 flex items-center justify-between rounded-3xl border border-border/70 px-4 py-3">
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

                          <div className="rounded-3xl border border-border/70 bg-muted/20 p-4">
                            <FieldLabel className="mb-2">Why no raw YAML?</FieldLabel>
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
                          <div className="rounded-3xl border border-border/70 bg-muted/20 p-4">
                            <FieldLabel className="mb-2">Launch URL</FieldLabel>
                            <code className="bg-background block rounded-2xl border border-border/70 px-3 py-3 text-xs leading-6 break-all">
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
                            <Button variant="outline" onClick={handleCopyLaunchURL}>
                              <CopyIcon className="size-3.5" />
                              Copy URL
                            </Button>
                          </div>
                        </SurfaceCard>

                        <div className="space-y-6">
                          <SurfaceCard
                            eyebrow={<FileTextIcon className="size-4" />}
                            title="Archive assets"
                            description="A compact map of what this settings dialog can control today."
                          >
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">AGENTS.md</p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    Editable from the Prompt tab.
                                  </p>
                                </div>
                                <Badge variant="secondary">editable</Badge>
                              </div>
                              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">config.yaml</p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    Managed from the Config tab.
                                  </p>
                                </div>
                                <Badge variant="outline">structured</Badge>
                              </div>
                              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium">skills/</p>
                                  <p className="text-muted-foreground text-xs leading-5">
                                    Current copied skills are shown in Profile.
                                  </p>
                                </div>
                                <Badge variant="outline">{skillNames.length}</Badge>
                              </div>
                            </div>
                          </SurfaceCard>

                          <SurfaceCard
                            eyebrow={<Settings2Icon className="size-4" />}
                            title="Editor access"
                            description="Reserved for a future browser editor or code-server endpoint."
                          >
                            <p className="text-muted-foreground text-sm leading-6">
                              This deployment does not expose a dedicated VS Code
                              server or file browser endpoint yet. For now, use
                              the Prompt and Config tabs to edit the agent-owned
                              archive safely from the workspace.
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

        <div className="border-t border-border/70 bg-background/95 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                {isDirty ? "Unsaved archive changes" : "Archive is up to date"}
              </p>
              <p className="text-muted-foreground text-xs leading-5">
                Save applies to the currently selected {agentStatus} archive only.
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
