import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getAPIClient } from "../api";
import { useAuth } from "../auth";

import {
  searchThreads,
  type ThreadSearchParams,
  updateThreadTitle,
} from "./api";
import type { AgentThread } from "./types";

export function useThreads(
  params: ThreadSearchParams = {
    limit: 50,
    offset: 0,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "updated_at", "values"],
  },
) {
  const { authenticated } = useAuth();
  return useQuery<AgentThread[]>({
    queryKey: ["threads", "search", params],
    queryFn: () => searchThreads(params),
    enabled: authenticated,
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await apiClient.threads.delete(threadId);
    },
    onSuccess(_, { threadId }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: AgentThread[] | undefined) => {
          if (!oldData) {
            return oldData;
          }
          return oldData.filter((t) => t.thread_id !== threadId);
        },
      );
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
      await updateThreadTitle(threadId, title);
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: AgentThread[] | undefined) => {
          if (!oldData) {
            return oldData;
          }
          return oldData.map((t) => {
            if (t.thread_id === threadId) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });
}
