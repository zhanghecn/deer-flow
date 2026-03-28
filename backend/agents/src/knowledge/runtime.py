from __future__ import annotations

from collections.abc import Sequence

from src.config.runtime_db import get_runtime_db_store
from src.utils.runtime_context import runtime_context_value


def resolve_knowledge_runtime_identity(runtime_context: object) -> tuple[str, str]:
    thread_id = str(
        runtime_context_value(runtime_context, "thread_id")
        or runtime_context_value(runtime_context, "x-thread-id")
        or ""
    ).strip()
    user_id = str(
        runtime_context_value(runtime_context, "user_id")
        or runtime_context_value(runtime_context, "x-user-id")
        or ""
    ).strip()

    if not thread_id:
        raise ValueError("thread_id is required in runtime context.")

    if not user_id:
        binding = get_runtime_db_store().get_thread_binding(thread_id)
        if binding is not None:
            user_id = binding.user_id

    if not user_id:
        raise ValueError("user_id is required in runtime context.")

    return user_id, thread_id


def _normalize_runtime_ids(value: object) -> tuple[str, ...]:
    if value is None:
        return ()

    if isinstance(value, str):
        parts = value.replace("\n", ",").replace("，", ",").replace("、", ",").split(",")
    elif isinstance(value, Sequence):
        parts = [str(item or "") for item in value]
    else:
        return ()

    normalized: list[str] = []
    seen: set[str] = set()
    for part in parts:
        item = str(part or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return tuple(normalized)


def resolve_knowledge_selected_document_ids(runtime_context: object) -> tuple[str, ...]:
    return _normalize_runtime_ids(
        runtime_context_value(runtime_context, "knowledge_document_ids")
        or runtime_context_value(runtime_context, "selected_knowledge_document_ids")
    )


def resolve_knowledge_selected_base_ids(runtime_context: object) -> tuple[str, ...]:
    return _normalize_runtime_ids(
        runtime_context_value(runtime_context, "knowledge_base_ids")
        or runtime_context_value(runtime_context, "selected_knowledge_base_ids")
    )
