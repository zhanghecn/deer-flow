BEGIN;

ALTER TABLE knowledge_document_nodes
    ADD COLUMN IF NOT EXISTS prefix_summary TEXT,
    ADD COLUMN IF NOT EXISTS node_text TEXT;

COMMIT;
