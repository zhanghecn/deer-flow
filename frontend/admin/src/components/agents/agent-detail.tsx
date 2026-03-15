import { CopyIcon, ExternalLinkIcon, Loader2, RocketIcon, SaveIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Agent } from "@/types";

interface AgentDetailProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type AgentFormState = {
  description: string;
  model: string;
  toolGroups: string;
  mcpServers: string;
  agentsMD: string;
  memoryEnabled: boolean;
  memoryModel: string;
  debounceSeconds: string;
  maxFacts: string;
  confidenceThreshold: string;
  injectionEnabled: boolean;
  maxInjectionTokens: string;
};

function toCSV(values: string[] | undefined) {
  return (values ?? []).join(", ");
}

function parseCSV(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createFormState(agent: Agent): AgentFormState {
  return {
    description: agent.description ?? "",
    model: agent.model ?? "",
    toolGroups: toCSV(agent.tool_groups),
    mcpServers: toCSV(agent.mcp_servers),
    agentsMD: agent.agents_md ?? "",
    memoryEnabled: agent.memory?.enabled ?? false,
    memoryModel: agent.memory?.model_name ?? "",
    debounceSeconds: String(agent.memory?.debounce_seconds ?? 30),
    maxFacts: String(agent.memory?.max_facts ?? 100),
    confidenceThreshold: String(agent.memory?.fact_confidence_threshold ?? 0.7),
    injectionEnabled: agent.memory?.injection_enabled ?? true,
    maxInjectionTokens: String(agent.memory?.max_injection_tokens ?? 2000),
  };
}

function frontendBaseURL() {
  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }
  const envURL = import.meta.env.VITE_FRONTEND_BASE_URL as string | undefined;
  if (envURL) {
    return envURL.replace(/\/+$/, "");
  }
  return `http://${window.location.hostname}:3000`;
}

function buildDemoURL(
  agentName: string,
  status: string,
  executionBackend: "default" | "remote",
  remoteSessionID: string,
) {
  const params = new URLSearchParams();
  params.set("agent_status", status);
  if (executionBackend === "remote") {
    params.set("execution_backend", "remote");
  }
  if (remoteSessionID.trim()) {
    params.set("remote_session_id", remoteSessionID.trim());
  }

  const pathname =
    agentName === "lead_agent"
      ? "/workspace/chats/new"
      : `/workspace/agents/${encodeURIComponent(agentName)}/chats/new`;
  const query = params.toString();
  return `${frontendBaseURL()}${pathname}${query ? `?${query}` : ""}`;
}

export function AgentDetail({
  agent,
  open,
  onOpenChange,
  onSaved,
}: AgentDetailProps) {
  const [detail, setDetail] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentFormState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [launchMode, setLaunchMode] = useState<"default" | "remote">("default");
  const [remoteSessionID, setRemoteSessionID] = useState("");

  useEffect(() => {
    if (!open || !agent) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void api<Agent>(`/api/agents/${agent.name}?status=${agent.status}`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setDetail(payload);
        setForm(createFormState(payload));
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to load agent detail",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agent, open]);

  const demoURL = useMemo(() => {
    if (!detail) {
      return "";
    }
    return buildDemoURL(
      detail.name,
      detail.status,
      launchMode,
      remoteSessionID,
    );
  }, [detail, launchMode, remoteSessionID]);

  if (!agent) return null;

  async function handleSave() {
    if (!detail || !form) {
      return;
    }

    setIsSaving(true);
    try {
      const updated = await api<Agent>(`/api/agents/${detail.name}?status=${detail.status}`, {
        method: "PUT",
        body: {
          description: form.description,
          model: form.model.trim() ? form.model.trim() : null,
          tool_groups: parseCSV(form.toolGroups),
          mcp_servers: parseCSV(form.mcpServers),
          skills: detail.skills?.map((skill) => skill.name) ?? [],
          agents_md: form.agentsMD,
          memory: {
            enabled: form.memoryEnabled,
            model_name: form.memoryModel.trim() ? form.memoryModel.trim() : null,
            debounce_seconds: Number(form.debounceSeconds),
            max_facts: Number(form.maxFacts),
            fact_confidence_threshold: Number(form.confidenceThreshold),
            injection_enabled: form.injectionEnabled,
            max_injection_tokens: Number(form.maxInjectionTokens),
          },
        },
      });
      setDetail(updated);
      setForm(createFormState(updated));
      toast.success(`${updated.name} saved`);
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save agent");
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    if (!detail) {
      return;
    }
    setIsPublishing(true);
    try {
      const published = await api<Agent>(`/api/agents/${detail.name}/publish`, {
        method: "POST",
      });
      setDetail((current) =>
        current ? { ...current, status: current.status } : current,
      );
      toast.success(`${published.name} published`);
      onSaved?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to publish agent",
      );
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleCopyDemoURL() {
    try {
      await navigator.clipboard.writeText(demoURL);
      toast.success("Demo URL copied");
    } catch {
      toast.error("Failed to copy demo URL");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {agent.name}
            <Badge variant={agent.status === "prod" ? "default" : "secondary"}>
              {agent.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Edit archived agent metadata, prompt, and launch parameters.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[72vh] pr-3">
          {isLoading || !detail || !form ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading agent detail...
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={detail.name} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Input value={detail.status} disabled />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Description</Label>
                  <Textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input
                    value={form.model}
                    onChange={(event) =>
                      setForm({ ...form, model: event.target.value })
                    }
                    placeholder="glm-5 / kimi-k2.5-1 / ..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tool Groups</Label>
                  <Input
                    value={form.toolGroups}
                    onChange={(event) =>
                      setForm({ ...form, toolGroups: event.target.value })
                    }
                    placeholder="filesystem, web, office"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>MCP Servers</Label>
                  <Input
                    value={form.mcpServers}
                    onChange={(event) =>
                      setForm({ ...form, mcpServers: event.target.value })
                    }
                    placeholder="server-a, server-b"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium">Memory Policy</h4>
                    <p className="text-muted-foreground text-xs">
                      Stored per `user_id + agent_name + status`.
                    </p>
                  </div>
                  <Switch
                    checked={form.memoryEnabled}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, memoryEnabled: checked })
                    }
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Memory Model</Label>
                    <Input
                      value={form.memoryModel}
                      onChange={(event) =>
                        setForm({ ...form, memoryModel: event.target.value })
                      }
                      placeholder="Required when memory is enabled"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Debounce Seconds</Label>
                    <Input
                      type="number"
                      value={form.debounceSeconds}
                      onChange={(event) =>
                        setForm({ ...form, debounceSeconds: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Facts</Label>
                    <Input
                      type="number"
                      value={form.maxFacts}
                      onChange={(event) =>
                        setForm({ ...form, maxFacts: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Confidence Threshold</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={form.confidenceThreshold}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          confidenceThreshold: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Injection Tokens</Label>
                    <Input
                      type="number"
                      value={form.maxInjectionTokens}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          maxInjectionTokens: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">Inject Memory</div>
                      <div className="text-muted-foreground text-xs">
                        Include memory in prompt context
                      </div>
                    </div>
                    <Switch
                      checked={form.injectionEnabled}
                      onCheckedChange={(checked) =>
                        setForm({ ...form, injectionEnabled: checked })
                      }
                    />
                  </div>
                </div>
              </div>

              {detail.skills && detail.skills.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Materialized Skills</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.skills.map((skill) => (
                        <Badge key={`${skill.name}:${skill.source_path ?? skill.materialized_path}`}>
                          {skill.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-2">
                <Label>AGENTS.md</Label>
                <Textarea
                  value={form.agentsMD}
                  onChange={(event) =>
                    setForm({ ...form, agentsMD: event.target.value })
                  }
                  rows={22}
                  className="font-mono text-xs"
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium">Demo URL</h4>
                  <p className="text-muted-foreground text-xs">
                    Launch the frontend workspace directly into this agent.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                  <div className="space-y-2">
                    <Label>Runtime</Label>
                    <select
                      value={launchMode}
                      onChange={(event) =>
                        setLaunchMode(event.target.value as "default" | "remote")
                      }
                      className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    >
                      <option value="default">default runtime</option>
                      <option value="remote">remote cli</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Remote Session ID</Label>
                    <Input
                      value={remoteSessionID}
                      onChange={(event) => setRemoteSessionID(event.target.value)}
                      disabled={launchMode !== "remote"}
                      placeholder="optional when runtime=remote"
                    />
                  </div>
                </div>
                <Textarea value={demoURL} readOnly rows={3} className="text-xs" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleCopyDemoURL}>
                    <CopyIcon className="h-4 w-4" />
                    Copy URL
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={demoURL} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon className="h-4 w-4" />
                      Open Demo
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2">
          {detail?.status === "dev" && (
            <Button
              variant="outline"
              onClick={() => void handlePublish()}
              disabled={isPublishing || isLoading}
            >
              {isPublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RocketIcon className="h-4 w-4" />
              )}
              Publish
            </Button>
          )}
          <Button onClick={() => void handleSave()} disabled={isSaving || isLoading}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SaveIcon className="h-4 w-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
