import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ExecutionStatus } from "@/core/threads";

import {
  getLatestThreadPublicAPIInvocation,
  mergeExecutionStatusWithPublicAPIStatus,
  publicAPIInvocationToExecutionStatus,
} from "./invocations";

export function useLatestThreadPublicAPIInvocation({
  threadId,
  enabled = true,
}: {
  threadId: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["public-api-invocation", "latest-thread", threadId],
    queryFn: () => getLatestThreadPublicAPIInvocation(threadId),
    enabled: enabled && threadId.trim().length > 0,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });
}

export function useThreadPublicAPIExecutionStatus({
  enabled = true,
  liveExecutionStatus,
  threadId,
  threadLoading,
}: {
  enabled?: boolean;
  liveExecutionStatus?: ExecutionStatus | null;
  threadId: string;
  threadLoading: boolean;
}) {
  const { data: latestInvocation } = useLatestThreadPublicAPIInvocation({
    threadId,
    enabled: enabled && !threadLoading,
  });
  const publicAPIStatus = useMemo(
    () =>
      threadLoading
        ? null
        : publicAPIInvocationToExecutionStatus(latestInvocation),
    [latestInvocation, threadLoading],
  );

  return useMemo(
    () =>
      mergeExecutionStatusWithPublicAPIStatus(
        liveExecutionStatus,
        publicAPIStatus,
      ),
    [liveExecutionStatus, publicAPIStatus],
  );
}
