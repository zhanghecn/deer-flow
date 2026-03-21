import { describe, expect, it } from "vitest";

import type { AgentThread } from "./types";
import {
  buildCurrentPath,
  buildThreadCompletionNotificationBody,
  buildThreadPath,
  buildThreadRuntimeContext,
  didThreadRuntimeSelectionChange,
  pathAfterThreadDeletion,
  pathOfThread,
  resolveThreadRuntimeBinding,
} from "./utils";

describe("thread runtime utils", () => {
  it("normalizes persisted thread runtime bindings", () => {
    expect(
      resolveThreadRuntimeBinding({
        agent_name: "reviewer",
        agent_status: "prod",
        execution_backend: "remote",
        remote_session_id: "remote-1",
        model_name: "kimi-k2.5",
      }),
    ).toEqual({
      agentName: "reviewer",
      agentStatus: "prod",
      executionBackend: "remote",
      remoteSessionId: "remote-1",
      modelName: "kimi-k2.5",
    });
  });

  it("builds runtime-aware thread paths", () => {
    expect(
      pathOfThread({
        thread_id: "thread-1",
        agent_name: "reviewer",
        agent_status: "prod",
        execution_backend: "remote",
        remote_session_id: "remote-1",
      }),
    ).toBe(
      "/workspace/agents/reviewer/chats/thread-1?agent_status=prod&execution_backend=remote&remote_session_id=remote-1",
    );

    expect(pathOfThread("thread-2")).toBe(
      "/workspace/chats/thread-2?agent_status=dev",
    );
  });

  it("builds thread paths with transient route flags", () => {
    expect(
      buildThreadPath(
        {
          agentName: "reviewer",
          agentStatus: "prod",
          executionBackend: "remote",
          remoteSessionId: "remote-1",
        },
        "thread-1",
        {
          isMock: true,
          isPendingRun: true,
        },
      ),
    ).toBe(
      "/workspace/agents/reviewer/chats/thread-1?agent_status=prod&execution_backend=remote&remote_session_id=remote-1&pending_run=1&mock=true",
    );
  });

  it("builds runtime context objects from runtime selection", () => {
    expect(
      buildThreadRuntimeContext({
        agentName: "reviewer",
        agentStatus: "prod",
        executionBackend: "remote",
        remoteSessionId: "remote-1",
      }),
    ).toEqual({
      agent_name: "reviewer",
      agent_status: "prod",
      execution_backend: "remote",
      remote_session_id: "remote-1",
    });
  });

  it("detects runtime selection changes", () => {
    expect(
      didThreadRuntimeSelectionChange(
        {
          agentName: "lead_agent",
          agentStatus: "dev",
          executionBackend: undefined,
          remoteSessionId: "",
        },
        {
          agentName: "reviewer",
          agentStatus: "dev",
          executionBackend: undefined,
          remoteSessionId: "",
        },
      ),
    ).toBe(true);

    expect(
      didThreadRuntimeSelectionChange(
        {
          agentName: "reviewer",
          agentStatus: "prod",
          executionBackend: "remote",
          remoteSessionId: "remote-1",
        },
        {
          agentName: "reviewer",
          agentStatus: "prod",
          executionBackend: "remote",
          remoteSessionId: "remote-1",
        },
      ),
    ).toBe(false);
  });

  it("picks the next visible thread after a deletion", () => {
    expect(
      pathAfterThreadDeletion(
        [
          {
            thread_id: "thread-1",
            agent_name: "lead_agent",
            agent_status: "dev",
          } as AgentThread,
          {
            thread_id: "thread-2",
            agent_name: "reviewer",
            agent_status: "prod",
          } as AgentThread,
        ],
        "thread-1",
      ),
    ).toBe("/workspace/agents/reviewer/chats/thread-2?agent_status=prod");
  });

  it("falls back to a new chat in the deleted thread runtime when no siblings remain", () => {
    expect(
      pathAfterThreadDeletion(
        [
          {
            thread_id: "thread-1",
            agent_name: "reviewer",
            agent_status: "prod",
            execution_backend: "remote",
            remote_session_id: "remote-1",
          } as AgentThread,
        ],
        "thread-1",
      ),
    ).toBe(
      "/workspace/agents/reviewer/chats/new?agent_status=prod&execution_backend=remote&remote_session_id=remote-1",
    );
  });

  it("rebuilds the current path from pathname and search params", () => {
    expect(
      buildCurrentPath(
        "/workspace/chats/thread-1",
        new URLSearchParams("agent_status=prod&mock=true"),
      ),
    ).toBe("/workspace/chats/thread-1?agent_status=prod&mock=true");
  });

  it("builds a concise completion notification body", () => {
    expect(
      buildThreadCompletionNotificationBody({
        messages: [],
      }),
    ).toBe("Conversation finished");

    expect(
      buildThreadCompletionNotificationBody({
        messages: [
          {
            type: "ai",
            content: "done",
          } as AgentThread["values"]["messages"][number],
        ],
      }),
    ).toBe("done");

    expect(
      buildThreadCompletionNotificationBody({
        messages: [
          {
            type: "ai",
            content: "x".repeat(220),
          } as AgentThread["values"]["messages"][number],
        ],
      }),
    ).toBe(`${"x".repeat(200)}...`);
  });
});
