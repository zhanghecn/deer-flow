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

export interface AdminAPIToken {
  id: string;
  user_id: string;
  token?: string;
  name: string;
  scopes: string[];
  status: string;
  allowed_agents: string[];
  last_used?: string | null;
  revoked_at?: string | null;
  created_at: string;
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
  context_window?: TraceContextWindow;
}

export interface TraceContextWindow {
  usage_ratio?: number | null;
  usage_ratio_after_summary?: number | null;
  approx_input_tokens?: number | null;
  approx_input_tokens_after_summary?: number | null;
  max_input_tokens?: number | null;
  summary_applied?: boolean | null;
  summary_count?: number | null;
  last_summary?: {
    created_at?: string;
    summary_preview?: string;
  } | null;
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

export interface RuntimeStorageDirectoryUsage {
  bytes: number;
  file_count: number;
  dir_count: number;
}

export interface RuntimeStorageDirectoryBreakdown {
  thread_root: RuntimeStorageDirectoryUsage;
  workspace: RuntimeStorageDirectoryUsage;
  uploads: RuntimeStorageDirectoryUsage;
  outputs: RuntimeStorageDirectoryUsage;
  authoring: RuntimeStorageDirectoryUsage;
  runtime_agents: RuntimeStorageDirectoryUsage;
  other_user_data: RuntimeStorageDirectoryUsage;
  missing_on_disk: boolean;
  orphan_on_disk: boolean;
  latest_modified?: string | null;
}

export interface RuntimeStorageCheckpointTableUsage {
  rows: number;
  bytes: number;
}

export interface RuntimeStorageCheckpointUsage {
  thread_id: string;
  checkpoints: RuntimeStorageCheckpointTableUsage;
  checkpoint_writes: RuntimeStorageCheckpointTableUsage;
  checkpoint_blobs: RuntimeStorageCheckpointTableUsage;
}

export interface RuntimeStorageThreadUsage {
  thread_id: string;
  user_id?: string;
  user_name?: string | null;
  user_email?: string | null;
  agent_name?: string | null;
  model_name?: string | null;
  assistant_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_used_at?: string | null;
  inactive_days: number;
  directories: RuntimeStorageDirectoryBreakdown;
  checkpoint: RuntimeStorageCheckpointUsage;
  filesystem_bytes: number;
  runtime_cache_bytes: number;
  checkpoint_bytes: number;
  total_bytes: number;
  file_count: number;
  dir_count: number;
  candidate_reasons: string[];
  protection_reasons: string[];
  orphan_fs_candidate: boolean;
  full_delete_eligible: boolean;
}

export interface RuntimeStorageUserUsage {
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  thread_count: number;
  filesystem_bytes: number;
  runtime_cache_bytes: number;
  checkpoint_bytes: number;
  total_bytes: number;
  largest_thread_id?: string;
  largest_thread_bytes: number;
  last_used_at?: string | null;
  cleanup_candidate_count: number;
}

export interface RuntimeStorageSummary {
  scan: {
    status: string;
    last_started_at?: string | null;
    last_success_at?: string | null;
    error?: string;
  };
  thread_count: number;
  user_count: number;
  orphan_thread_count: number;
  candidate_counts: Record<string, number>;
  filesystem: {
    base_dir_bytes: number;
    thread_bytes: number;
    runtime_cache_bytes: number;
    file_count: number;
    dir_count: number;
    inode_usage_percent?: number | null;
    disk_usage_percent?: number | null;
  };
  checkpoint: {
    enabled: boolean;
    rows: number;
    bytes: number;
    tables: Array<{ name: string; rows: number; bytes: number }>;
  };
  top_users: RuntimeStorageUserUsage[];
  top_threads: RuntimeStorageThreadUsage[];
  recent_jobs: RuntimeStorageCleanupJob[];
}

export interface RuntimeStorageCleanupRequest {
  action: RuntimeStorageCleanupAction;
  thread_ids?: string[];
  user_id?: string;
  inactive_days?: number;
  limit?: number;
}

export interface RuntimeStorageCleanupPolicy {
  action: RuntimeStorageCleanupAction;
  enabled: boolean;
  dry_run: boolean;
  inactive_days: number;
  schedule: "hourly" | "daily" | "weekly";
  run_at: string;
  limit: number;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_job_id?: string;
  last_preview_at?: string | null;
  last_preview_candidates: number;
  last_preview_bytes: number;
  last_error?: string;
  updated_at?: string | null;
}

export type RuntimeStorageCleanupPolicyUpdate = Partial<
  Pick<
    RuntimeStorageCleanupPolicy,
    "enabled" | "dry_run" | "inactive_days" | "schedule" | "run_at" | "limit"
  >
>;

export type RuntimeStorageCleanupAction = "full_thread_delete";

export interface RuntimeStorageCleanupCandidate {
  thread_id: string;
  user_id?: string;
  action: RuntimeStorageCleanupAction;
  reason: string;
  bytes_reclaimable: number;
  checkpoint_rows: number;
  protection_reasons?: string[];
  eligible: boolean;
}

export interface RuntimeStorageCleanupPreview {
  action: RuntimeStorageCleanupAction;
  candidates: RuntimeStorageCleanupCandidate[];
  refused: RuntimeStorageCleanupCandidate[];
  total_bytes_reclaimable: number;
  total_checkpoint_rows: number;
  generated_at: string;
}

export interface RuntimeStorageCleanupJob {
  job_id: string;
  admin_user_id?: string;
  action: RuntimeStorageCleanupAction;
  status: string;
  request: RuntimeStorageCleanupRequest;
  preview: RuntimeStorageCleanupPreview;
  items: Array<{
    thread_id: string;
    user_id?: string;
    action: RuntimeStorageCleanupAction;
    status: string;
    bytes_planned: number;
    bytes_freed: number;
    checkpoint_rows_planned: number;
    checkpoint_rows_deleted: number;
    error?: string;
    finished_at?: string | null;
  }>;
  error?: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface AdminStats {
  user_count: number;
  trace_count: number;
  total_tokens_in: number;
  total_tokens_out: number;
  thread_count: number;
}

export interface AdminModel {
  name: string;
  display_name?: string | null;
  provider: string;
  enabled: boolean;
  config_json: Record<string, unknown>;
  created_at: string;
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

export type AgentStatus = "dev" | "prod";

export interface Agent {
  name: string;
  description: string;
  model?: string;
  tool_groups?: string[];
  mcp_servers?: string[];
  status: AgentStatus;
  memory?: AgentMemoryConfig | null;
  agents_md: string;
  skills?: Array<{
    name: string;
    status?: string;
    category?: string;
    source_path?: string;
    materialized_path?: string;
  }>;
}
