BEGIN;

CREATE TABLE IF NOT EXISTS knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_type VARCHAR(32) NOT NULL DEFAULT 'sidebar',
    command_name VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user_id ON knowledge_bases(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created_at ON knowledge_bases(created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_kind VARCHAR(32) NOT NULL,
    locator_type VARCHAR(32) NOT NULL,
    source_storage_path TEXT NOT NULL,
    markdown_storage_path TEXT,
    preview_storage_path TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'processing',
    error TEXT,
    doc_description TEXT,
    page_count INTEGER,
    node_count INTEGER NOT NULL DEFAULT 0,
    build_model_name VARCHAR(128),
    document_tree JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_base_id ON knowledge_documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_user_id ON knowledge_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status ON knowledge_documents(status);

CREATE TABLE IF NOT EXISTS knowledge_document_nodes (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    parent_node_id VARCHAR(64),
    node_path TEXT NOT NULL,
    title TEXT NOT NULL,
    depth INTEGER NOT NULL,
    child_count INTEGER NOT NULL DEFAULT 0,
    locator_type VARCHAR(32) NOT NULL,
    page_start INTEGER,
    page_end INTEGER,
    line_start INTEGER,
    line_end INTEGER,
    heading_slug TEXT,
    summary TEXT,
    excerpt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_nodes_document_id ON knowledge_document_nodes(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_nodes_parent ON knowledge_document_nodes(document_id, parent_node_id, node_path);

CREATE TABLE IF NOT EXISTS knowledge_thread_bindings (
    thread_id VARCHAR(64) NOT NULL,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (thread_id, knowledge_base_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_thread_bindings_user_id ON knowledge_thread_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_thread_bindings_base_id ON knowledge_thread_bindings(knowledge_base_id);

COMMIT;
