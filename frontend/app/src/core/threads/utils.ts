import type { Message } from "@langchain/langgraph-sdk";

import {
  buildWorkspaceAgentPath,
  type AgentExecutionBackend,
  type ResolvedAgentRuntimeSelection,
} from "../agents";

import type { AgentThread, ThreadRuntimeBinding } from "./types";

export type ResolvedThreadRuntimeBinding = ResolvedAgentRuntimeSelection & {
  modelName?: string;
};

export function resolveThreadRuntimeBinding(
  binding: ThreadRuntimeBinding | null | undefined,
): ResolvedThreadRuntimeBinding {
  const executionBackend: AgentExecutionBackend =
    binding?.execution_backend === "remote" ? "remote" : undefined;
  return {
    agentName: binding?.agent_name?.trim() || "lead_agent",
    agentStatus: binding?.agent_status === "prod" ? "prod" : "dev",
    executionBackend,
    remoteSessionId: binding?.remote_session_id?.trim() || "",
    modelName: binding?.model_name?.trim() || undefined,
  };
}

export function pathOfThread(
  threadOrId:
    | string
    | (ThreadRuntimeBinding & {
        thread_id: string;
      }),
) {
  if (typeof threadOrId === "string") {
    return buildWorkspaceAgentPath({}, threadOrId);
  }

  const selection = resolveThreadRuntimeBinding(threadOrId);
  return buildWorkspaceAgentPath(
    {
      agentName: selection.agentName,
      agentStatus: selection.agentStatus,
      executionBackend: selection.executionBackend,
      remoteSessionId: selection.remoteSessionId,
    },
    threadOrId.thread_id,
  );
}

export function pathAfterThreadDeletion(
  threads: AgentThread[],
  deletedThreadId: string,
) {
  const deletedThreadIndex = threads.findIndex(
    (thread) => thread.thread_id === deletedThreadId,
  );
  if (deletedThreadIndex < 0) {
    return "/workspace/chats/new";
  }

  const adjacentThread =
    threads[deletedThreadIndex + 1] ?? threads[deletedThreadIndex - 1];
  if (adjacentThread) {
    return pathOfThread(adjacentThread);
  }

  return buildWorkspaceAgentPath(
    resolveThreadRuntimeBinding(threads[deletedThreadIndex]),
  );
}

export function textOfMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        return part.text;
      }
    }
  }
  return null;
}

export function titleOfThread(thread: AgentThread) {
  return thread.values?.title ?? "Untitled";
}
