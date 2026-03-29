export interface KnowledgeBuildJob {
  id: string;
  status: string;
  stage?: string;
  message?: string;
  progress_percent: number;
  total_steps: number;
  completed_steps: number;
  model_name?: string;
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

export interface KnowledgeTreeNode {
  node_id: string;
  title: string;
  depth?: number;
  child_count?: number;
  returned_child_count?: number;
  remaining_child_count?: number;
  has_more_children?: boolean;
  locator_type: "page" | "heading";
  page_start?: number;
  page_end?: number;
  line_start?: number;
  line_end?: number;
  heading_slug?: string;
  summary?: string;
  visual_summary?: string;
  summary_quality?: "llm" | "extractive" | "fallback";
  has_visual_evidence?: boolean;
  evidence_ref_count?: number;
  nodes?: KnowledgeTreeNode[];
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
  node_count: number;
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

export interface KnowledgeDocumentDebugPayload {
  knowledge_base_id: string;
  knowledge_base: string;
  owner_id: string;
  owner_name: string;
  visibility: string;
  preview_enabled: boolean;
  document: KnowledgeDocument;
  document_tree: KnowledgeTreeNode[];
  canonical_markdown?: string;
  source_map_json?: unknown;
  document_index_json?: unknown;
}
