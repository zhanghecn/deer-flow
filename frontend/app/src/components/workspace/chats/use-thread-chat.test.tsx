import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDraftThreadId,
  resolveThreadRouteIdentity,
  useThreadChat,
} from "./use-thread-chat";

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
  beforeEach(() => {
    window.sessionStorage.clear();
    clearDraftThreadId("/workspace/chats/new");
    clearDraftThreadId("/workspace/agents/demo-agent/chats/new");
  });

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

  it("reuses the same draft thread id for new-chat sidebars and pages", () => {
    const first = resolveThreadRouteIdentity("/workspace/chats/new", "new");
    const second = resolveThreadRouteIdentity("/workspace/chats/new", "new");

    expect(first.isNewThread).toBe(true);
    expect(first.threadId).toBeTruthy();
    expect(second.threadId).toBe(first.threadId);
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

  it("switches to the latest existing-thread route immediately", async () => {
    const observedThreadIds: string[] = [];

    function Probe() {
      const { threadId } = useThreadChat();
      observedThreadIds.push(threadId);
      return null;
    }

    const router = createMemoryRouter(
      [
        {
          path: "/workspace/agents/:agent_name/chats/:thread_id",
          element: <Probe />,
        },
      ],
      {
        initialEntries: ["/workspace/agents/agent-a/chats/thread-a"],
      },
    );

    render(<RouterProvider router={router} />);

    await act(async () => {
      await router.navigate("/workspace/agents/agent-b/chats/thread-b");
    });

    expect(observedThreadIds.at(-1)).toBe("thread-b");
  });
});
