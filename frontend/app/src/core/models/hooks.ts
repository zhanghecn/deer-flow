import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import { loadModels } from "./api";

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: () => loadModels(),
    enabled: enabled && authenticated,
    refetchOnWindowFocus: false,
  });
  return { models: data ?? [], isLoading, error };
}
