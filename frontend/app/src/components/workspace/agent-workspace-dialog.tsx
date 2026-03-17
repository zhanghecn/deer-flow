"use client";

import {
  BotIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  Settings2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildWorkspaceAgentPath,
  isLeadAgent,
  type AgentRuntimeSelection,
  type AgentStatus,
  type ResolvedAgentRuntimeSelection,
  useAgent,
} from "@/core/agents";
import { cn } from "@/lib/utils";

import { AgentRuntimeControls } from "./agent-runtime-controls";
import { AgentSettingsDialog } from "./agent-settings-dialog";

type RuntimeValue = {
  agent_name?: string;
  agent_status?: AgentStatus;
  execution_backend?: "remote";
  remote_session_id?: string;
};

function toRuntimeValue(
  selection: ResolvedAgentRuntimeSelection,
): RuntimeValue {
  return {
    agent_name: selection.agentName,
    agent_status: selection.agentStatus,
    execution_backend: selection.executionBackend,
    remote_session_id: selection.remoteSessionId || undefined,
  };
}

function toRuntimeSelection(value: RuntimeValue): AgentRuntimeSelection {
  return {
    agentName: value.agent_name,
    agentStatus: value.agent_status,
    executionBackend: value.execution_backend,
    remoteSessionId: value.remote_session_id,
  };
}

export function AgentWorkspaceDialog({
  selection,
  className,
  compact = false,
  align = "left",
}: {
  selection: ResolvedAgentRuntimeSelection;
  className?: string;
  compact?: boolean;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<RuntimeValue>(() =>
    toRuntimeValue(selection),
  );

  useEffect(() => {
    if (!open) {
      setDraft(toRuntimeValue(selection));
    }
  }, [open, selection]);

  const selectedAgentName = draft.agent_name?.trim() ?? "lead_agent";
  const selectedAgentStatus = draft.agent_status ?? "dev";
  const { agent, isLoading } = useAgent(
    open ? selectedAgentName : null,
    selectedAgentStatus,
  );

  const launchPath = useMemo(
    () => buildWorkspaceAgentPath(toRuntimeSelection(draft)),
    [draft],
  );

  const skills = useMemo(
    () => agent?.skills?.map((skill) => skill.name).filter(Boolean) ?? [],
    [agent?.skills],
  );

  async function handleCopyURL() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${launchPath}`,
      );
      toast.success("Workspace URL copied");
    } catch {
      toast.error("Failed to copy workspace URL");
    }
  }

  function handleOpenWorkspace() {
    router.push(launchPath);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "border-border/70 bg-background/85 hover:bg-background/95 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left shadow-xs backdrop-blur transition-colors",
          compact ? "h-9 text-xs" : "h-10 text-sm",
          className,
        )}
      >
        <BotIcon className="text-primary size-4 shrink-0" />
        <span className="max-w-[180px] truncate font-medium">
          {isLeadAgent(selection.agentName)
            ? "lead_agent"
            : selection.agentName}
        </span>
        {!compact && (
          <span className="text-muted-foreground text-[11px] uppercase">
            {selection.agentStatus}
          </span>
        )}
        {selection.executionBackend === "remote" && (
          <span className="text-muted-foreground text-[11px] uppercase">
            remote
          </span>
        )}
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            "flex h-[80vh] max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0 sm:max-w-5xl",
            align === "right" ? "sm:mr-6" : "sm:ml-6",
          )}
          aria-describedby={undefined}
        >
          <div className="border-border/70 border-b px-6 py-5">
            <DialogHeader className="text-left">
              <DialogTitle>Agent Workspace</DialogTitle>
              <DialogDescription>
                Switch the active archive, runtime, and launch target without
                crowding the main workspace.
              </DialogDescription>
            </DialogHeader>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.15fr)_320px]">
              <div className="space-y-4">
                <AgentRuntimeControls value={draft} onValueChange={setDraft} />

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleOpenWorkspace}>
                    <ExternalLinkIcon className="size-3.5" />
                    Open workspace
                  </Button>
                  <Button variant="outline" onClick={handleCopyURL}>
                    <CopyIcon className="size-3.5" />
                    Copy URL
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings2Icon className="size-3.5" />
                    Archive settings
                  </Button>
                </div>
              </div>

              <aside className="space-y-4">
                <section className="border-border/70 bg-muted/15 rounded-3xl border p-4">
                  <div className="flex items-center gap-2">
                    <BotIcon className="text-primary size-4" />
                    <p className="text-sm font-medium">
                      {isLeadAgent(selectedAgentName)
                        ? "lead_agent"
                        : selectedAgentName}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="capitalize">
                      {selectedAgentStatus}
                    </Badge>
                    {draft.execution_backend === "remote" && (
                      <Badge variant="secondary">remote cli</Badge>
                    )}
                    <Badge variant="outline">
                      {skills.length} copied skill
                      {skills.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-3 text-sm leading-6">
                    {isLoading
                      ? "Loading archive summary..."
                      : (agent?.description ??
                        "Open the archive settings to edit AGENTS.md, config, and attached skills.")}
                  </p>
                </section>

                <section className="border-border/70 bg-background/70 rounded-3xl border p-4">
                  <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                    Copied skills
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {skills.length > 0 ? (
                      skills.map((skillName) => (
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
                        No copied skills are attached to this archive yet.
                      </p>
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AgentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        agentName={selectedAgentName}
        agentStatus={selectedAgentStatus}
        executionBackend={draft.execution_backend}
        remoteSessionId={draft.remote_session_id ?? undefined}
      />
    </>
  );
}
