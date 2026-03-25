from src.agents.middlewares.knowledge_context_middleware import (
    build_knowledge_context_prompt,
)
from src.knowledge.models import KnowledgeDocumentRecord
from src.knowledge.runtime import resolve_knowledge_runtime_identity


class _FakeBinding:
    def __init__(self, user_id: str) -> None:
        self.user_id = user_id


class _FakeDBStore:
    def __init__(self, binding: _FakeBinding | None) -> None:
        self._binding = binding

    def get_thread_binding(self, thread_id: str):
        assert thread_id == "thread-1"
        return self._binding


def _document(name: str, *, document_id: str) -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(
        id=document_id,
        knowledge_base_id="kb-1",
        knowledge_base_name="Finance",
        knowledge_base_description=None,
        display_name=name,
        file_kind="pdf",
        locator_type="page",
        status="ready",
        doc_description=f"description for {name}",
        error=None,
        page_count=20,
        node_count=8,
        source_storage_path="knowledge/source.pdf",
        markdown_storage_path=None,
        preview_storage_path="knowledge/preview.pdf",
    )

def test_resolve_knowledge_runtime_identity_uses_explicit_user_id(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(None),
    )

    assert resolve_knowledge_runtime_identity(
        {"thread_id": "thread-1", "user_id": "user-1"}
    ) == ("user-1", "thread-1")


def test_resolve_knowledge_runtime_identity_falls_back_to_thread_binding(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )

    assert resolve_knowledge_runtime_identity({"thread_id": "thread-1"}) == (
        "user-from-binding",
        "thread-1",
    )


def test_build_knowledge_context_prompt_uses_thread_binding_fallback(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, ready_only=False: [
            _document("annual-report.pdf", document_id=f"{user_id}:{thread_id}")
        ],
    )

    prompt = build_knowledge_context_prompt({"thread_id": "thread-1"})

    assert "<knowledge_documents>" in prompt
    assert '"document_id": "user-from-binding:thread-1"' in prompt
    assert '"document_name": "annual-report.pdf"' in prompt


def test_build_knowledge_context_prompt_prioritizes_user_and_agent_document_targets(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, ready_only=False: [
            _document("annual-report.pdf", document_id="doc-1"),
            _document("board-deck-q4.md", document_id="doc-2"),
        ],
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.load_agents_md",
        lambda *args, **kwargs: "@knowledge[board-deck-q4.md]",
    )

    prompt = build_knowledge_context_prompt(
        {
            "thread_id": "thread-1",
            "knowledge_document_mentions": ["annual-report.pdf"],
            "agent_name": "researcher",
            "agent_status": "dev",
        }
    )

    assert "<knowledge_document_selection>" in prompt
    assert "<knowledge_tool_protocol>" in prompt
    assert "User-explicit document targets for this turn" in prompt
    assert "annual-report.pdf [Finance]" in prompt
    assert "Treat these explicit targets as a hard retrieval preference" in prompt
    assert "Do not reuse an earlier turn's citation" in prompt
    assert "Forbidden path for attached knowledge-document QA" in prompt
    assert "grep" in prompt
    assert "AGENTS.md default document targets when relevant" in prompt
    assert "board-deck-q4.md [Finance]" in prompt
    assert "get_document_image" in prompt
