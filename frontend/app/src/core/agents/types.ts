export type AgentStatus = "prod" | "dev";

export interface AgentMemoryConfig {
  enabled: boolean;
  model_name: string | null;
  debounce_seconds: number;
  max_facts: number;
  fact_confidence_threshold: number;
  injection_enabled: boolean;
  max_injection_tokens: number;
}

export interface AgentSkillRef {
  name: string;
  category: string | null;
  source_path: string | null;
  materialized_path: string | null;
}

export interface AgentSkillRefInput {
  name: string;
  category?: string | null;
  source_path?: string | null;
  materialized_path?: string | null;
}

export interface AgentSubagentDefaults {
  general_purpose_enabled: boolean;
  tool_names: string[] | null;
}

export interface AgentSubagent {
  name: string;
  description: string;
  system_prompt: string;
  model: string | null;
  tool_names: string[] | null;
  enabled: boolean;
}

export interface ToolCatalogItem {
  name: string;
  group: string;
  label: string;
  description: string;
  configurable_for_main_agent: boolean;
  configurable_for_subagent: boolean;
  reserved_policy: "normal" | "main_agent_only" | "runtime_only";
}

export interface Agent {
  name: string;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  tool_names?: string[] | null;
  mcp_servers?: string[] | null;
  status: AgentStatus;
  memory?: AgentMemoryConfig | null;
  subagent_defaults?: AgentSubagentDefaults | null;
  subagents?: AgentSubagent[];
  skills?: AgentSkillRef[];
  agents_md?: string | null;
}

export interface AgentExportEndpoint {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface AgentExportDoc {
  agent: string;
  status: AgentStatus;
  api_base_url: string;
  endpoints: {
    stream: AgentExportEndpoint;
    chat: AgentExportEndpoint;
  };
  demo: {
    framework: string;
    method: string;
    url: string;
    notes: string[];
  };
  documentation_url: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  model?: string | null;
  tool_groups?: string[] | null;
  tool_names?: string[] | null;
  mcp_servers?: string[] | null;
  memory?: AgentMemoryConfig;
  subagent_defaults?: AgentSubagentDefaults | null;
  subagents?: AgentSubagent[];
  skills?: string[];
  skill_refs?: AgentSkillRefInput[];
  agents_md?: string;
}

export interface UpdateAgentRequest {
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  tool_names?: string[] | null;
  mcp_servers?: string[] | null;
  memory?: AgentMemoryConfig;
  subagent_defaults?: AgentSubagentDefaults | null;
  subagents?: AgentSubagent[];
  skills?: string[];
  skill_refs?: AgentSkillRefInput[];
  agents_md?: string | null;
}
