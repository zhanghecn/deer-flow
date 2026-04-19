from src.gateway.routers.tools import build_runtime_tool_catalog


def test_runtime_tool_catalog_includes_middleware_scanned_tools() -> None:
    items = build_runtime_tool_catalog()
    by_name = {item.name: item for item in items}

    assert "read_file" in by_name
    assert "task" in by_name
    assert "write_todos" in by_name

    assert by_name["read_file"].source == "middleware"
    assert by_name["read_file"].configurable_for_main_agent is False
    assert by_name["task"].reserved_policy == "middleware_injected"
    assert by_name["task"].read_only_reason


def test_runtime_tool_catalog_keeps_configurable_archive_tools() -> None:
    items = build_runtime_tool_catalog()
    by_name = {item.name: item for item in items}

    assert "question" in by_name
    assert by_name["question"].configurable_for_main_agent is True
    assert by_name["question"].configurable_for_subagent is False
    assert by_name["question"].reserved_policy == "main_agent_only"
