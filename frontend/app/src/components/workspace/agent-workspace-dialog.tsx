"use client";

import { BotIcon, ChevronDownIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { isLeadAgent, type ResolvedAgentRuntimeSelection } from "@/core/agents";
import { cn } from "@/lib/utils";

const SettingsDialog = dynamic(
  () => import("./settings/settings-dialog").then((m) => m.SettingsDialog),
  { ssr: false },
);

export function AgentWorkspaceDialog({
  selection,
  className,
  compact = false,
}: {
  selection: ResolvedAgentRuntimeSelection;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const agentName = isLeadAgent(selection.agentName)
    ? "lead_agent"
    : selection.agentName;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "border-border/70 bg-background/88 hover:bg-background inline-flex items-center gap-2 rounded-full border text-left shadow-xs backdrop-blur transition-colors",
          compact ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
          className,
        )}
      >
        <BotIcon className="text-primary size-4 shrink-0" />
        <span className="max-w-[132px] truncate font-medium">{agentName}</span>
        <span className="text-muted-foreground text-[11px] uppercase">
          {selection.agentStatus}
        </span>
        {selection.executionBackend === "remote" && (
          <span className="text-muted-foreground hidden text-[11px] uppercase sm:inline">
            remote
          </span>
        )}
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
      </button>

      {open && (
        <SettingsDialog
          open={open}
          onOpenChange={setOpen}
          defaultSection="agents"
        />
      )}
    </>
  );
}
