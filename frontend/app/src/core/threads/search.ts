export type ThreadSearchParams = {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: string;
  select?: string[];
};

export const THREAD_SEARCH_QUERY_KEY = ["threads", "search"] as const;
export const THREAD_RUNTIME_QUERY_KEY = ["threads", "runtime"] as const;

export const DEFAULT_THREAD_SEARCH_PARAMS: Required<ThreadSearchParams> = {
  limit: 50,
  offset: 0,
  sortBy: "updated_at",
  sortOrder: "desc",
  select: ["thread_id", "updated_at", "values"],
};

export function resolveThreadSearchParams(
  params: ThreadSearchParams = {},
): Required<ThreadSearchParams> {
  return {
    limit: params.limit ?? DEFAULT_THREAD_SEARCH_PARAMS.limit,
    offset: params.offset ?? DEFAULT_THREAD_SEARCH_PARAMS.offset,
    sortBy: params.sortBy ?? DEFAULT_THREAD_SEARCH_PARAMS.sortBy,
    sortOrder: params.sortOrder ?? DEFAULT_THREAD_SEARCH_PARAMS.sortOrder,
    select: params.select ?? DEFAULT_THREAD_SEARCH_PARAMS.select,
  };
}

export function buildThreadSearchQueryKey(params: ThreadSearchParams = {}) {
  return [
    ...THREAD_SEARCH_QUERY_KEY,
    resolveThreadSearchParams(params),
  ] as const;
}

export function buildThreadRuntimeQueryKey(threadId?: string | null) {
  return [...THREAD_RUNTIME_QUERY_KEY, threadId ?? null] as const;
}
