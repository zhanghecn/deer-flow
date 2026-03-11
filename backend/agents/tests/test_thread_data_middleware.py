from unittest.mock import MagicMock

import pytest

from src.agents.middlewares.thread_data_middleware import ThreadDataMiddleware


def _runtime(context: dict | None = None) -> MagicMock:
    runtime = MagicMock()
    runtime.context = context or {}
    return runtime


def test_thread_data_middleware_reads_thread_id_from_runtime_context(tmp_path):
    middleware = ThreadDataMiddleware(base_dir=str(tmp_path))

    result = middleware.before_agent(
        {},
        _runtime({"thread_id": "thread-1"}),
        config={},
    )

    assert result is not None
    assert result["thread_data"]["workspace_path"].endswith("/threads/thread-1/user-data/workspace")
    assert result["thread_data"]["authoring_agents_path"].endswith("/threads/thread-1/user-data/authoring/agents")
    assert result["thread_data"]["authoring_skills_path"].endswith("/threads/thread-1/user-data/authoring/skills")


def test_thread_data_middleware_falls_back_to_configurable_thread_id(tmp_path):
    middleware = ThreadDataMiddleware(base_dir=str(tmp_path))

    result = middleware.before_agent(
        {},
        _runtime(),
        config={"configurable": {"thread_id": "thread-2"}},
    )

    assert result is not None
    assert result["thread_data"]["uploads_path"].endswith("/threads/thread-2/user-data/uploads")
    assert result["thread_data"]["agents_path"].endswith("/threads/thread-2/user-data/agents")


def test_thread_data_middleware_requires_thread_id(tmp_path):
    middleware = ThreadDataMiddleware(base_dir=str(tmp_path))

    with pytest.raises(ValueError, match="Thread ID is required"):
        middleware.before_agent({}, _runtime(), config={})
