export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface TraceItem {
  trace_id: string;
  root_run_id: string;
  thread_id?: string;
  user_id?: string;
  agent_name?: string;
  model_name?: string;
  started_at: string;
  finished_at?: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  error?: string;
  metadata?: Record<string, unknown>;
  initial_user_message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface TraceEvent {
  id: number;
  trace_id: string;
  event_index: number;
  run_id: string;
  parent_run_id?: string;
  run_type: string;
  event_type: string;
  node_name?: string;
  tool_name?: string;
  task_run_id?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  status: string;
  error?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface RuntimeThread {
  thread_id: string;
  user_id?: string;
  agent_name?: string;
  model_name?: string;
  assistant_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CheckpointStatus {
  enabled: boolean;
  tables: { name: string }[];
}

export interface AdminStats {
  user_count: number;
  trace_count: number;
  total_tokens_in: number;
  total_tokens_out: number;
  thread_count: number;
}

export interface AgentMemoryConfig {
  enabled: boolean;
  model_name?: string | null;
  debounce_seconds: number;
  max_facts: number;
  fact_confidence_threshold: number;
  injection_enabled: boolean;
  max_injection_tokens: number;
}

export interface Agent {
  id: string;
  name: string;
  display_name?: string;
  description: string;
  avatar_url?: string;
  model?: string;
  tool_groups?: string[];
  mcp_servers?: string[];
  status: string;
  memory?: AgentMemoryConfig | null;
  agents_md: string;
  config_json?: Record<string, unknown>;
  created_by?: string;
  created_at: string;
  updated_at: string;
}
