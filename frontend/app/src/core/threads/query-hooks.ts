import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getAPIClient } from "../api";
import { useAuth } from "../auth";

import {
  clearThreads,
  deleteThread,
  getThreadRuntime,
  searchThreads,
  type ThreadSearchResult,
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
import type { ThreadRuntimeBinding } from "./types";

function removeThreadFromSearchResult(
  oldData: ThreadSearchResult | undefined,
  threadId: string,
) {
  if (!oldData) {
    return oldData;
  }

  const nextItems = oldData.items.filter((thread) => thread.thread_id !== threadId);
  const removedCount = oldData.items.length - nextItems.length;

  return {
    ...oldData,
    items: nextItems,
    total: Math.max(0, oldData.total - removedCount),
  };
}

function clearThreadSearchResult() {
  return {
    items: [],
    total: 0,
  };
}

function renameThreadInSearchResult(
  oldData: ThreadSearchResult | undefined,
  threadId: string,
  title: string,
) {
  if (!oldData) {
    return oldData;
  }

  return {
    ...oldData,
    items: oldData.items.map((thread) => {
      if (thread.thread_id !== threadId) {
        return thread;
      }

      return {
        ...thread,
        values: {
          ...thread.values,
          title,
        },
      };
    }),
  };
}

export function useThreads(
  params: ThreadSearchParams = DEFAULT_THREAD_SEARCH_PARAMS,
) {
  const { authenticated } = useAuth();
  return useQuery<ThreadSearchResult>({
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
        (oldData: ThreadSearchResult | undefined) =>
          removeThreadFromSearchResult(oldData, threadId),
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
        () => clearThreadSearchResult(),
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
        (oldData: ThreadSearchResult | undefined) =>
          renameThreadInSearchResult(oldData, threadId, title),
      );
    },
  });
}
