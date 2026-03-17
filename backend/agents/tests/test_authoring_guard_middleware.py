from types import SimpleNamespace

from src.agents.lead_agent import agent as lead_agent_module
from src.agents.middlewares.authoring_guard_middleware import (
    AuthoringGuardMiddleware,
    blocked_create_agent_tool_message,
    filter_create_agent_model_tools,
    is_protected_create_agent_path,
    should_enforce_setup_agent_guard,
)
from src.agents.middlewares.runtime_command_middleware import RuntimeCommandMiddleware
from src.config.model_config import ModelConfig


def _tool_request(
    name: str,
    *,
    args: dict | None = None,
    context: dict | None = None,
):
    return SimpleNamespace(
        tool_call={
            "id": "call-1",
            "name": name,
            "args": args or {},
        },
        runtime=SimpleNamespace(context=context or {}),
    )


def _tool(name: str):
    return SimpleNamespace(name=name)


def _model() -> ModelConfig:
    return ModelConfig(
        name="safe-model",
        display_name="safe-model",
        description=None,
        use="langchain_openai:ChatOpenAI",
        model="safe-model",
        supports_thinking=True,
        supports_vision=False,
    )


def test_should_enforce_setup_agent_guard_only_for_create_agent_with_target():
    assert not should_enforce_setup_agent_guard({"command_name": "create-agent"})
    assert not should_enforce_setup_agent_guard({"command_name": "create-skill", "target_agent_name": "demo"})
    assert should_enforce_setup_agent_guard(
        {"command_name": "create-agent", "target_agent_name": "demo-agent"}
    )


def test_is_protected_create_agent_path_matches_runtime_roots():
    assert is_protected_create_agent_path("/mnt/user-data/agents/dev/demo/AGENTS.md")
    assert is_protected_create_agent_path("/mnt/user-data/authoring/agents/demo/AGENTS.md")
    assert is_protected_create_agent_path("/mnt/user-data/authoring/skills/demo/SKILL.md")
    assert not is_protected_create_agent_path("/mnt/user-data/workspace/demo.md")


def test_blocked_create_agent_tool_message_blocks_direct_agent_file_writes():
    request = _tool_request(
        "write_file",
        args={"file_path": "/mnt/user-data/agents/dev/demo/AGENTS.md"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "setup_agent" in blocked.content


def test_blocked_create_agent_tool_message_blocks_shell_commands_touching_agent_roots():
    request = _tool_request(
        "execute",
        args={"command": "mkdir -p /mnt/user-data/authoring/agents/demo"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "setup_agent" in blocked.content


def test_filter_create_agent_model_tools_removes_direct_file_mutation_tools():
    filtered = filter_create_agent_model_tools(
        [_tool("read_file"), _tool("write_file"), _tool("edit_file"), _tool("setup_agent")]
    )

    assert [tool.name for tool in filtered] == ["read_file", "setup_agent"]


def test_build_openagents_middlewares_includes_authoring_guard():
    middlewares = lead_agent_module._build_openagents_middlewares(_model())

    assert any(isinstance(middleware, AuthoringGuardMiddleware) for middleware in middlewares)
    assert any(isinstance(middleware, RuntimeCommandMiddleware) for middleware in middlewares)
