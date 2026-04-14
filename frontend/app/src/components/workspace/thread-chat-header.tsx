import type { BaseStream } from "@langchain/langgraph-sdk";

import { AgentSwitcherDialog } from "@/components/workspace/agent-switcher-dialog";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { type ResolvedAgentRuntimeSelection } from "@/core/agents";
import type { AgentThreadState } from "@/core/threads";
import { cn } from "@/lib/utils";

import { ThreadActionsMenu } from "./thread-actions-menu";
import { ThreadWorkbenchTrigger } from "./thread-workbench-trigger";

export function ThreadChatHeader({
  runtimeSelection,
  showCenteredComposer,
  thread,
  threadId,
}: {
  runtimeSelection: ResolvedAgentRuntimeSelection;
  showCenteredComposer: boolean;
  thread: BaseStream<AgentThreadState>;
  threadId: string;
}) {
  return (
    <header
      className={cn(
        "absolute top-0 right-0 left-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4",
        showCenteredComposer
          ? "bg-background/0 backdrop-blur-none"
          : "bg-background/80 shadow-xs backdrop-blur",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AgentSwitcherDialog selection={runtimeSelection} compact />
        <div className="min-w-0 flex-1">
          <ThreadTitle
            className="text-muted-foreground text-sm font-medium"
            threadId={threadId}
            thread={thread}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <ThreadWorkbenchTrigger thread={thread} threadId={threadId} />
        <ThreadActionsMenu runtimeSelection={runtimeSelection} />
      </div>
    </header>
  );
}
