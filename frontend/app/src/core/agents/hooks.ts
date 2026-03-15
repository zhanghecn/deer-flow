import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  publishAgent,
  updateAgent,
} from "./api";
import type {
  AgentStatus,
  CreateAgentRequest,
  UpdateAgentRequest,
} from "./types";

export function useAgents(status?: AgentStatus) {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents", status ?? "all"],
    queryFn: () => listAgents(status),
    enabled: authenticated,
  });
  return { agents: data ?? [], isLoading, error };
}

export function useAgent(
  name: string | null | undefined,
  status?: AgentStatus,
) {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents", name, status ?? "dev"],
    queryFn: () => getAgent(name!, status),
    enabled: authenticated && !!name,
  });
  return { agent: data ?? null, isLoading, error };
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAgentRequest) => createAgent(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      request,
    }: {
      name: string;
      request: UpdateAgentRequest;
    }) => updateAgent(name, request),
    onSuccess: (_data, { name }) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", name] });
    },
  });
}

export function usePublishAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => publishAgent(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteAgent(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
