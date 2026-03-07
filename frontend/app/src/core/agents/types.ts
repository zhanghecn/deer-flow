export interface Agent {
  name: string;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  status?: "prod" | "dev";
  agents_md?: string | null;
  /** @deprecated Use agents_md instead */
  soul?: string | null;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  model?: string | null;
  tool_groups?: string[] | null;
  agents_md?: string;
  /** @deprecated Use agents_md instead */
  soul?: string;
}

export interface UpdateAgentRequest {
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  agents_md?: string | null;
  /** @deprecated Use agents_md instead */
  soul?: string | null;
}
