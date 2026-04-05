import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import { createSkill, enableSkill, getSkill, updateSkill } from "./api";
import type { CreateSkillRequest, UpdateSkillRequest } from "./type";

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

export function useSkill(name: string | null, sourcePath?: string) {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["skills", name, sourcePath ?? ""],
    queryFn: () => getSkill(name!, sourcePath),
    enabled: authenticated && !!name,
  });
  return { skill: data ?? null, isLoading, error };
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateSkillRequest) => createSkill(request),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
      void queryClient.invalidateQueries({
        queryKey: ["skills", data.name, data.source_path ?? ""],
      });
    },
  });
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

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillName,
      request,
    }: {
      skillName: string;
      request: UpdateSkillRequest;
    }) => updateSkill(skillName, request),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
      void queryClient.invalidateQueries({
        queryKey: ["skills", data.name, data.source_path ?? ""],
      });
    },
  });
}
