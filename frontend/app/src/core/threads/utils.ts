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

type ThreadPathOptions = {
  isMock?: boolean;
  isPendingRun?: boolean;
};

export function resolveThreadRuntimeBinding(
  binding: ThreadRuntimeBinding | null | undefined,
): ResolvedThreadRuntimeBinding {
  const agentName = binding?.agent_name?.trim();
  const remoteSessionId = binding?.remote_session_id?.trim();
  const modelName = binding?.model_name?.trim();
  const executionBackend: AgentExecutionBackend =
    binding?.execution_backend === "remote" ? "remote" : undefined;
  return {
    agentName: agentName && agentName.length > 0 ? agentName : "lead_agent",
    agentStatus: binding?.agent_status === "prod" ? "prod" : "dev",
    executionBackend,
    remoteSessionId:
      remoteSessionId && remoteSessionId.length > 0 ? remoteSessionId : "",
    modelName: modelName && modelName.length > 0 ? modelName : undefined,
  };
}

export function buildThreadRuntimeContext(
  selection: ResolvedAgentRuntimeSelection,
) {
  return {
    agent_name: selection.agentName,
    agent_status: selection.agentStatus,
    execution_backend: selection.executionBackend,
    remote_session_id:
      selection.remoteSessionId.length > 0
        ? selection.remoteSessionId
        : undefined,
  };
}

export function didThreadRuntimeSelectionChange(
  routeSelection: ResolvedAgentRuntimeSelection,
  runtimeSelection: ResolvedAgentRuntimeSelection,
) {
  return (
    routeSelection.agentName !== runtimeSelection.agentName ||
    routeSelection.agentStatus !== runtimeSelection.agentStatus ||
    routeSelection.executionBackend !== runtimeSelection.executionBackend ||
    routeSelection.remoteSessionId !== runtimeSelection.remoteSessionId
  );
}

function buildPathWithThreadFlags(
  basePath: string,
  { isMock, isPendingRun }: ThreadPathOptions = {},
) {
  const [pathname = basePath, search = ""] = basePath.split("?", 2);
  const params = new URLSearchParams(search);

  if (isPendingRun) {
    params.set("pending_run", "1");
  } else {
    params.delete("pending_run");
  }

  if (isMock) {
    params.set("mock", "true");
  } else {
    params.delete("mock");
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildThreadPath(
  selection: ResolvedAgentRuntimeSelection,
  threadId = "new",
  options?: ThreadPathOptions,
) {
  return buildPathWithThreadFlags(
    buildWorkspaceAgentPath(selection, threadId),
    options,
  );
}

export function buildCurrentPath(
  pathname: string,
  searchParams: Pick<URLSearchParams, "toString">,
) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
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

export function buildThreadCompletionNotificationBody(
  threadState: Pick<AgentThread["values"], "messages">,
) {
  const lastMessage = threadState.messages?.at(-1);
  if (!lastMessage) {
    return "Conversation finished";
  }

  const textContent = textOfMessage(lastMessage);
  if (!textContent) {
    return "Conversation finished";
  }

  return textContent.length > 200
    ? `${textContent.substring(0, 200)}...`
    : textContent;
}

export function titleOfThread(thread: AgentThread) {
  return thread.values?.title ?? "Untitled";
}
