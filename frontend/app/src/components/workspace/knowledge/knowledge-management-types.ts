import type { KnowledgeDocument } from "@/core/knowledge/types";

export type LibraryDocumentView = KnowledgeDocument & {
  owner_id: string;
  owner_name: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  knowledge_base_description?: string;
  attached_to_thread: boolean;
  visibility: string;
  preview_enabled: boolean;
};

export type BaseWorkbenchTab = "wiki" | "graph";

export type KnowledgePreviewMode = "preview" | "canonical";

export type KnowledgePreviewFocus = {
  nodeId?: string;
  title?: string;
  locatorLabel?: string;
  page?: number;
  pageEnd?: number;
  heading?: string;
  line?: number;
  lineEnd?: number;
};
