BEGIN;

ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS canonical_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS source_map_storage_path TEXT;

CREATE TABLE IF NOT EXISTS knowledge_build_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    stage VARCHAR(64),
    message TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    model_name VARCHAR(128),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_build_jobs_document_id ON knowledge_build_jobs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_build_jobs_thread_id ON knowledge_build_jobs(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_build_jobs_status ON knowledge_build_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_build_events (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES knowledge_build_jobs(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    stage VARCHAR(64) NOT NULL,
    step_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    message TEXT,
    elapsed_ms INTEGER,
    retry_count INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_build_events_job_id ON knowledge_build_events(job_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_knowledge_build_events_document_id ON knowledge_build_events(document_id, id ASC);

COMMIT;
