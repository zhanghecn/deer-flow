import type { Command } from "@langchain/langgraph-sdk";
import type { BaseStream } from "@langchain/langgraph-sdk/react";
import { createContext, useContext } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { AgentThreadState } from "@/core/threads";

export interface ThreadContextType {
  thread: BaseStream<AgentThreadState>;
  isMock?: boolean;
  sendMessage?: (
    message: PromptInputMessage,
    extraContext?: Record<string, unknown>,
  ) => Promise<void>;
  resumeInterrupt?: (
    command: Command,
    extraContext?: Record<string, unknown>,
  ) => Promise<void>;
}

export const ThreadContext = createContext<ThreadContextType | undefined>(
  undefined,
);

export function useThread() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThread must be used within a ThreadContext");
  }
  return context;
}
