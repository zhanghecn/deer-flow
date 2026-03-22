import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import { loadModels } from "./api";

const MODELS_QUERY_STALE_TIME_MS = 60 * 1000;

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: () => loadModels(),
    enabled: enabled && authenticated,
    staleTime: MODELS_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  return { models: data ?? [], isLoading, error };
}
