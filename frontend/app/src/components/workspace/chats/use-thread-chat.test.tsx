import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useThreadChat } from "./use-thread-chat";

function createWrapper(initialEntry: string, path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={<>{children}</>} />
        </Routes>
      </MemoryRouter>
    );
  };
}

describe("useThreadChat", () => {
  it("treats /workspace/chats/new as a new thread on the first render", () => {
    const { result, rerender } = renderHook(() => useThreadChat(), {
      wrapper: createWrapper("/workspace/chats/new", "/workspace/chats/new"),
    });

    const initialThreadId = result.current.threadId;

    expect(result.current.isNewThread).toBe(true);
    expect(initialThreadId).toBeTruthy();

    rerender();

    expect(result.current.isNewThread).toBe(true);
    expect(result.current.threadId).toBe(initialThreadId);
  });

  it("treats agent new-chat routes as a new thread on the first render", () => {
    const { result, rerender } = renderHook(() => useThreadChat(), {
      wrapper: createWrapper(
        "/workspace/agents/demo-agent/chats/new",
        "/workspace/agents/:agent_name/chats/new",
      ),
    });

    const initialThreadId = result.current.threadId;

    expect(result.current.isNewThread).toBe(true);
    expect(initialThreadId).toBeTruthy();

    rerender();

    expect(result.current.isNewThread).toBe(true);
    expect(result.current.threadId).toBe(initialThreadId);
  });

  it("uses the route thread id for existing conversations", () => {
    const { result } = renderHook(() => useThreadChat(), {
      wrapper: createWrapper(
        "/workspace/chats/thread-123",
        "/workspace/chats/:thread_id",
      ),
    });

    expect(result.current.isNewThread).toBe(false);
    expect(result.current.threadId).toBe("thread-123");
  });
});
