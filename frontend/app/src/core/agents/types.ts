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

export interface Agent {
  name: string;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  mcp_servers?: string[] | null;
  status: AgentStatus;
  memory?: AgentMemoryConfig | null;
  skills?: AgentSkillRef[];
  agents_md?: string | null;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  model?: string | null;
  tool_groups?: string[] | null;
  mcp_servers?: string[] | null;
  memory?: AgentMemoryConfig;
  skills?: string[];
  agents_md?: string;
}

export interface UpdateAgentRequest {
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  mcp_servers?: string[] | null;
  memory?: AgentMemoryConfig;
  skills?: string[];
  agents_md?: string | null;
}
