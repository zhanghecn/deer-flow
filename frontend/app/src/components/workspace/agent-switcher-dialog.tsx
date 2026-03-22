import { BotIcon, ChevronDownIcon } from "lucide-react";
import { lazy, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { isLeadAgent, type ResolvedAgentRuntimeSelection } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const AgentSwitcherPanel = lazy(
  () => import("./agent-switcher-panel").then((m) => ({ default: m.AgentSwitcherPanel })),
);

export function AgentSwitcherDialog({
  selection,
  className,
  compact = false,
}: {
  selection: ResolvedAgentRuntimeSelection;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const agentName = isLeadAgent(selection.agentName)
    ? "lead_agent"
    : selection.agentName;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
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
              {t.agents.switcher.remoteRuntime}
            </span>
          )}
          <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t.agents.switcher.title}</DialogTitle>
          <DialogDescription>{t.agents.switcher.description}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto p-6">
          <AgentSwitcherPanel onClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
