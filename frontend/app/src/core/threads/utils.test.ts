import { describe, expect, it } from "vitest";

import type { AgentThread } from "./types";
import {
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
});
