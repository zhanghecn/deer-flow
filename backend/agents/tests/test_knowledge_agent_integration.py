from types import SimpleNamespace

from src.agents.lead_agent.agent import _build_openagents_middlewares
from src.agents.middlewares.knowledge_context_middleware import (
    KnowledgeContextMiddleware,
)


def test_build_openagents_middlewares_includes_knowledge_context():
    middlewares = _build_openagents_middlewares(
        SimpleNamespace(supports_vision=False),
    )

    assert any(isinstance(middleware, KnowledgeContextMiddleware) for middleware in middlewares)
