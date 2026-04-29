import type { AgentRuntimeMiddlewares, AgentSkillRef } from "@/core/agents";

export type SettingsTab = "identity" | "capabilities" | "behavior" | "integration";

export type AgentSubagentFormState = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolSelectionEnabled: boolean;
  toolNames: string[];
  enabled: boolean;
};

export type AgentSettingsFormState = {
  description: string;
  model: string;
  toolGroups: string;
  toolSelectionEnabled: boolean;
  toolNames: string[];
  runtimeMiddlewares: AgentRuntimeMiddlewares;
  mcpServers: string[];
  skillRefs: AgentSkillRef[];
  agentsMd: string;
  memoryEnabled: boolean;
  memoryModel: string;
  debounceSeconds: string;
  maxFacts: string;
  confidenceThreshold: string;
  injectionEnabled: boolean;
  maxInjectionTokens: string;
  generalPurposeEnabled: boolean;
  generalPurposeUsesMainTools: boolean;
  generalPurposeToolNames: string[];
  subagents: AgentSubagentFormState[];
};
