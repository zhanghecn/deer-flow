import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import { enableSkill } from "./api";

import { loadSkills } from ".";

const SKILLS_QUERY_STALE_TIME_MS = 60 * 1000;

export function useSkills() {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["skills"],
    queryFn: () => loadSkills(),
    enabled: authenticated,
    staleTime: SKILLS_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  return { skills: data ?? [], isLoading, error };
}

export function useEnableSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      skillName,
      enabled,
    }: {
      skillName: string;
      enabled: boolean;
    }) => {
      await enableSkill(skillName, enabled);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
