import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/hooks";

import {
  createAgent,
  deleteAgent,
  getAgent,
  getAgentExportDoc,
  getPublicAgentExportDoc,
  listAgents,
  listToolCatalog,
  publishAgent,
  updateAgent,
} from "./api";
import type {
  AgentExportDoc,
  AgentStatus,
  CreateAgentRequest,
  ToolCatalogItem,
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

export function useToolCatalog() {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery<ToolCatalogItem[]>({
    queryKey: ["tools", "catalog"],
    queryFn: () => listToolCatalog(),
    enabled: authenticated,
  });
  return { tools: data ?? [], isLoading, error };
}

export function useAgentExportDoc(
  name: string | null | undefined,
  enabled = true,
) {
  const { authenticated } = useAuth();
  const { data, isLoading, error } = useQuery<AgentExportDoc>({
    queryKey: ["agents", name, "export-doc"],
    queryFn: () => getAgentExportDoc(name!),
    enabled: authenticated && enabled && !!name,
  });
  return { exportDoc: data ?? null, isLoading, error };
}

export function usePublicAgentExportDoc(
  name: string | null | undefined,
  enabled = true,
) {
  const { data, isLoading, error } = useQuery<AgentExportDoc>({
    queryKey: ["public-agents", name, "export-doc"],
    queryFn: () => getPublicAgentExportDoc(name!),
    enabled: enabled && !!name,
    retry: false,
  });
  return { exportDoc: data ?? null, isLoading, error };
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
      status,
      request,
    }: {
      name: string;
      status?: AgentStatus;
      request: UpdateAgentRequest;
    }) => updateAgent(name, request, status),
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
    mutationFn: ({
      name,
      status,
    }: {
      name: string;
      status?: AgentStatus;
    }) => deleteAgent(name, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
