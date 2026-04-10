import { BotIcon } from "lucide-react";

import { type Agent } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function AgentWelcome({
  className,
  agent,
  agentName,
  agentStatus,
}: {
  className?: string;
  agent: Agent | null | undefined;
  agentName: string;
  agentStatus?: "dev" | "prod";
}) {
  const { t } = useI18n();
  const displayName = agent?.name ?? agentName;
  const description = agent?.description;

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-2 px-8 py-4 text-center",
        className,
      )}
    >
      <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-full">
        <BotIcon className="text-primary h-6 w-6" />
      </div>
      <div className="flex items-center gap-2 text-2xl font-bold">
        <span>{displayName}</span>
        {agentStatus === "dev" && (
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.22em]">
            {t.agents.draftBadge}
          </span>
        )}
      </div>
      {description && (
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      )}
    </div>
  );
}
