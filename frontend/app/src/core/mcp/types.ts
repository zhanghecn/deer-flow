export interface MCPProfile {
  name: string;
  server_name: string;
  category?: string;
  source_path?: string;
  can_edit: boolean;
  config_json: Record<string, unknown>;
}

export interface CreateMCPProfileRequest {
  name: string;
  config_json: Record<string, unknown>;
}

export interface UpdateMCPProfileRequest {
  config_json: Record<string, unknown>;
}

export interface MCPDiscoveredTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MCPProfileDiscoveryRequestItem {
  ref: string;
  profile_name: string;
  config_json: Record<string, unknown>;
}

export interface MCPProfileDiscoveryResult {
  ref: string;
  profile_name: string;
  server_name?: string | null;
  reachable: boolean;
  latency_ms?: number | null;
  tool_count: number;
  tools: MCPDiscoveredTool[];
  error?: string | null;
}
