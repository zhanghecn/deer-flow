from types import SimpleNamespace

from src.agents.lead_agent.agent import _materialize_agent_default_knowledge_bases


class _FakeKnowledgeRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def attach_base_to_thread(
        self,
        *,
        thread_id: str,
        knowledge_base_id: str,
        user_id: str,
    ) -> None:
        self.calls.append((thread_id, knowledge_base_id, user_id))


def test_materialize_agent_default_knowledge_bases_attaches_visible_defaults() -> None:
    repository = _FakeKnowledgeRepository()

    _materialize_agent_default_knowledge_bases(
        request=SimpleNamespace(thread_id="thread-1", user_id="user-1"),
        agent_config=SimpleNamespace(knowledge_base_ids=["kb-1", "kb-2"]),
        repository=repository,
    )

    assert repository.calls == [
        ("thread-1", "kb-1", "user-1"),
        ("thread-1", "kb-2", "user-1"),
    ]


def test_materialize_agent_default_knowledge_bases_requires_thread_identity() -> None:
    repository = _FakeKnowledgeRepository()

    _materialize_agent_default_knowledge_bases(
        request=SimpleNamespace(thread_id="thread-1", user_id=None),
        agent_config=SimpleNamespace(knowledge_base_ids=["kb-1"]),
        repository=repository,
    )

    assert repository.calls == []
