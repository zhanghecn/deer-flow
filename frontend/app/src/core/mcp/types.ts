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
