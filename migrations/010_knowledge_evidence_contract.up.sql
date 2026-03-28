BEGIN;

ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS build_quality VARCHAR(32) NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS quality_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE knowledge_document_nodes
    ADD COLUMN IF NOT EXISTS visual_summary TEXT,
    ADD COLUMN IF NOT EXISTS summary_quality VARCHAR(32) NOT NULL DEFAULT 'fallback',
    ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE knowledge_documents
SET build_quality = CASE
    WHEN status = 'ready_degraded' THEN 'degraded'
    WHEN status = 'ready' THEN 'ready'
    ELSE build_quality
END
WHERE build_quality IS NULL OR build_quality = '';

COMMIT;
