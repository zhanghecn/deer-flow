-- Remove the old PageTree / LLM-compiled knowledge schema from upgraded
-- databases. New installs still apply the historical 001 baseline first so
-- its checksum remains stable for existing deployments; this migration performs
-- the hard cut to the source-only workspace contract.

BEGIN;

DROP TABLE IF EXISTS knowledge_document_nodes;

DROP INDEX IF EXISTS idx_knowledge_documents_content_sha;

ALTER TABLE knowledge_documents
    DROP COLUMN IF EXISTS node_count,
    DROP COLUMN IF EXISTS build_model_name,
    DROP COLUMN IF EXISTS document_tree,
    DROP COLUMN IF EXISTS source_map_storage_path,
    DROP COLUMN IF EXISTS source_map_json,
    DROP COLUMN IF EXISTS document_index_json;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_content_sha
    ON knowledge_documents(content_sha256, file_kind, status);

ALTER TABLE knowledge_build_jobs
    DROP COLUMN IF EXISTS model_name;

COMMIT;
