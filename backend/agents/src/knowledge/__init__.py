from __future__ import annotations

__all__ = ["KnowledgeRepository", "KnowledgeService"]


def __getattr__(name: str):
    if name == "KnowledgeRepository":
        from .repository import KnowledgeRepository

        return KnowledgeRepository
    if name == "KnowledgeService":
        from .service import KnowledgeService

        return KnowledgeService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
