export interface KnowledgeBuildJob {
  id: string;
  status: string;
  stage?: string;
  message?: string;
  progress_percent: number;
  total_steps: number;
  completed_steps: number;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface KnowledgeBuildEvent {
  id: number;
  job_id: string;
  document_id: string;
  stage: string;
  step_name: string;
  status: string;
  message?: string;
  elapsed_ms?: number;
  retry_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface KnowledgeDocument {
  id: string;
  display_name: string;
  file_kind: string;
  locator_type: "page" | "heading";
  status: string;
  doc_description?: string;
  build_quality?: string;
  quality_metadata?: Record<string, unknown>;
  error?: string;
  page_count?: number;
  source_storage_path?: string;
  markdown_storage_path?: string;
  preview_storage_path?: string;
  canonical_storage_path?: string;
  created_at?: string;
  updated_at?: string;
  latest_build_job?: KnowledgeBuildJob;
}

export interface KnowledgeBase {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  description?: string;
  source_type: string;
  command_name?: string;
  visibility: string;
  preview_enabled: boolean;
  attached_to_thread: boolean;
  documents: KnowledgeDocument[];
}

export interface KnowledgeBaseListResponse {
  knowledge_bases: KnowledgeBase[];
}

export interface KnowledgeAcceptedResponse {
  knowledge_base_id: string;
  thread_id: string;
  status: string;
}

export interface KnowledgeBaseSettingsResponse {
  knowledge_base_id: string;
  preview_enabled: boolean;
}

export interface KnowledgeBaseDeletedResponse {
  knowledge_base_id: string;
  status: string;
}

export interface KnowledgeBasesClearedResponse {
  owner_id: string;
  deleted_count: number;
  status: string;
}

export interface KnowledgeDocumentBuildEventsResponse {
  events: KnowledgeBuildEvent[];
}

export interface KnowledgeWorkspaceFileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: KnowledgeWorkspaceFileNode[];
}

export interface KnowledgeWorkspaceSummary {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  description?: string;
  visibility: string;
  preview_enabled: boolean;
}

export interface KnowledgeWorkspaceTreeResponse {
  workspace: KnowledgeWorkspaceSummary;
  tree: KnowledgeWorkspaceFileNode[];
}

export interface KnowledgeWorkspaceFileResponse {
  workspace: KnowledgeWorkspaceSummary;
  path: string;
  content: string;
}

export interface KnowledgeWorkspaceGraphNode {
  id: string;
  label: string;
  type: string;
  path: string;
  link_count: number;
  community: number;
}

export interface KnowledgeWorkspaceGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface KnowledgeWorkspaceGraphCommunity {
  id: number;
  node_count: number;
  cohesion: number;
  top_nodes: string[];
}

export interface KnowledgeWorkspaceGraphInsightNode {
  id: string;
  label: string;
}

export interface KnowledgeWorkspaceGraphInsights {
  isolated_nodes: KnowledgeWorkspaceGraphInsightNode[];
  sparse_communities: KnowledgeWorkspaceGraphCommunity[];
  edge_count: number;
}

export interface KnowledgeWorkspaceGraphResponse {
  workspace: KnowledgeWorkspaceSummary;
  nodes: KnowledgeWorkspaceGraphNode[];
  edges: KnowledgeWorkspaceGraphEdge[];
  communities?: KnowledgeWorkspaceGraphCommunity[];
  insights?: KnowledgeWorkspaceGraphInsights;
}
