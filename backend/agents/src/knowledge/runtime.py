from __future__ import annotations

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
