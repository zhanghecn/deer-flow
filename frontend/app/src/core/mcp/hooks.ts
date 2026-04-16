import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import {
  createMCPProfile,
  deleteMCPProfile,
  listMCPProfiles,
  updateMCPProfile,
} from "./api";
import type {
  CreateMCPProfileRequest,
  UpdateMCPProfileRequest,
} from "./types";

export function useMCPProfiles() {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcpProfiles"],
    queryFn: () => listMCPProfiles(),
    enabled: authenticated,
  });
  return { profiles: data ?? [], isLoading, error };
}

export function useCreateMCPProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: CreateMCPProfileRequest) =>
      createMCPProfile(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcpProfiles"] });
    },
  });
}

export function useUpdateMCPProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      request,
    }: {
      name: string;
      request: UpdateMCPProfileRequest;
    }) => updateMCPProfile(name, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcpProfiles"] });
    },
  });
}

export function useDeleteMCPProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => deleteMCPProfile(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcpProfiles"] });
    },
  });
}
