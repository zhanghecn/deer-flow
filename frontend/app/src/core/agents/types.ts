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
  mcp_servers?: string[] | null;
  memory?: AgentMemoryConfig;
  skills?: string[];
  skill_refs?: AgentSkillRef[];
  agents_md?: string;
}

export interface UpdateAgentRequest {
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  mcp_servers?: string[] | null;
  memory?: AgentMemoryConfig;
  skills?: string[];
  skill_refs?: AgentSkillRef[];
  agents_md?: string | null;
}
