import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getAPIClient } from "../api";
import { useAuth } from "../auth";

import {
  clearThreads,
  deleteThread,
  getThreadRuntime,
  searchThreads,
  updateThreadTitle,
} from "./api";
import {
  buildThreadRuntimeQueryKey,
  buildThreadSearchQueryKey,
  DEFAULT_THREAD_SEARCH_PARAMS,
  THREAD_RUNTIME_QUERY_KEY,
  THREAD_SEARCH_QUERY_KEY,
  type ThreadSearchParams,
} from "./search";
import type { AgentThread, ThreadRuntimeBinding } from "./types";

export function useThreads(
  params: ThreadSearchParams = DEFAULT_THREAD_SEARCH_PARAMS,
) {
  const { authenticated } = useAuth();
  return useQuery<AgentThread[]>({
    queryKey: buildThreadSearchQueryKey(params),
    queryFn: () => searchThreads(params),
    enabled: authenticated,
    refetchOnWindowFocus: false,
  });
}

export function useThreadRuntime(threadId?: string | null) {
  const { authenticated } = useAuth();
  return useQuery<ThreadRuntimeBinding & { thread_id: string }>({
    queryKey: buildThreadRuntimeQueryKey(threadId),
    queryFn: () => getThreadRuntime(threadId!),
    enabled: authenticated && !!threadId,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await deleteThread(threadId);
    },
    onSuccess(_, { threadId }) {
      queryClient.setQueriesData(
        {
          queryKey: THREAD_SEARCH_QUERY_KEY,
          exact: false,
        },
        (oldData: AgentThread[] | undefined) => {
          if (!oldData) {
            return oldData;
          }
          return oldData.filter((t) => t.thread_id !== threadId);
        },
      );
      void queryClient.removeQueries({
        queryKey: buildThreadRuntimeQueryKey(threadId),
      });
    },
  });
}

export function useClearThreads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearThreads(),
    onSuccess() {
      queryClient.setQueriesData(
        {
          queryKey: THREAD_SEARCH_QUERY_KEY,
          exact: false,
        },
        () => [],
      );
      void queryClient.removeQueries({
        queryKey: THREAD_RUNTIME_QUERY_KEY,
        exact: false,
      });
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      const apiClient = getAPIClient(false, threadId);
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
      await updateThreadTitle(threadId, title);
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: THREAD_SEARCH_QUERY_KEY,
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
