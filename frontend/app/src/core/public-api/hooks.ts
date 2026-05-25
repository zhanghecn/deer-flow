import { useQuery } from "@tanstack/react-query";

import { getLatestThreadPublicAPIInvocation } from "./invocations";

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
