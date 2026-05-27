import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadSearchResult } from "./api";
import { updateThreadTitle } from "./api";
import { useRenameThread } from "./query-hooks";
import { buildThreadSearchQueryKey } from "./search";

vi.mock("../auth", () => ({
  useAuth: () => ({ authenticated: true }),
}));

vi.mock("./api", () => ({
  clearThreads: vi.fn(),
  deleteThread: vi.fn(),
  getThreadRuntime: vi.fn(),
  searchThreads: vi.fn(),
  updateThreadTitle: vi.fn().mockResolvedValue({
    thread_id: "thread-1",
    title: "Renamed title",
  }),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("thread query hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames threads through the gateway title API and updates search cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const queryKey = buildThreadSearchQueryKey();
    const searchResult: ThreadSearchResult = {
      items: [
        {
          thread_id: "thread-1",
          created_at: "2026-05-27T00:00:00Z",
          updated_at: "2026-05-27T00:00:00Z",
          values: {
            title: "Old title",
            messages: [],
            artifacts: [],
          },
          status: "idle",
          interrupts: {},
          metadata: {},
        },
      ],
      total: 1,
    };
    queryClient.setQueryData(queryKey, searchResult);

    const { result } = renderHook(() => useRenameThread(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        threadId: "thread-1",
        title: "Renamed title",
      });
    });

    expect(updateThreadTitle).toHaveBeenCalledWith(
      "thread-1",
      "Renamed title",
    );
    // Title edits are sidebar/search metadata. They must not write LangGraph
    // state, because active graph runs can reject `/state` writes with 409.
    expect(queryClient.getQueryData<ThreadSearchResult>(queryKey)).toMatchObject(
      {
        items: [
          {
            thread_id: "thread-1",
            values: { title: "Renamed title" },
          },
        ],
      },
    );
  });
});
