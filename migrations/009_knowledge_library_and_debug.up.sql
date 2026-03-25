BEGIN;

ALTER TABLE knowledge_bases
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) NOT NULL DEFAULT 'shared',
    ADD COLUMN IF NOT EXISTS preview_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_visibility ON knowledge_bases(visibility);

ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64),
    ADD COLUMN IF NOT EXISTS canonical_markdown TEXT,
    ADD COLUMN IF NOT EXISTS source_map_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS document_index_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_content_sha
    ON knowledge_documents(content_sha256, file_kind, status, build_model_name);

COMMIT;
