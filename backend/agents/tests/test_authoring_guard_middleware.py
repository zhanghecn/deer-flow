from types import SimpleNamespace

from src.agents.lead_agent import agent as lead_agent_module
from src.agents.middlewares.authoring_guard_middleware import (
    AuthoringGuardMiddleware,
    blocked_direct_authoring_tool_message,
    blocked_create_agent_tool_message,
    blocked_self_agent_persistence_tool_message,
    filter_direct_authoring_model_tools,
    filter_create_agent_model_tools,
    is_read_only_create_agent_shell_command,
    is_protected_create_agent_path,
    should_enforce_direct_authoring_guard,
    should_enforce_self_agent_persistence_guard,
    should_enforce_setup_agent_guard,
    uses_forbidden_create_agent_host_path,
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


def test_should_enforce_setup_agent_guard_for_all_create_agent_turns():
    assert should_enforce_setup_agent_guard({"command_name": "create-agent"})
    assert not should_enforce_setup_agent_guard({"command_name": "create-skill", "target_agent_name": "demo"})
    assert should_enforce_setup_agent_guard(
        {"command_name": "create-agent", "target_agent_name": "demo-agent"}
    )


def test_should_enforce_direct_authoring_guard_only_for_hard_authoring_turns():
    assert not should_enforce_direct_authoring_guard({"command_kind": "soft", "authoring_actions": ["push_skill_prod"]})
    assert not should_enforce_direct_authoring_guard({"command_kind": "hard", "authoring_actions": []})
    assert should_enforce_direct_authoring_guard(
        {"command_kind": "hard", "authoring_actions": ["push_skill_prod"]}
    )


def test_should_enforce_self_agent_persistence_guard_for_non_lead_dev_agents():
    assert should_enforce_self_agent_persistence_guard({"agent_name": "demo-agent", "agent_status": "dev"})
    assert not should_enforce_self_agent_persistence_guard({"agent_name": "lead_agent", "agent_status": "dev"})
    assert not should_enforce_self_agent_persistence_guard({"agent_name": "demo-agent", "agent_status": "prod"})


def test_should_enforce_direct_authoring_guard_ignores_create_agent_even_if_marked_hard():
    assert not should_enforce_direct_authoring_guard(
        {
            "command_name": "create-agent",
            "command_kind": "hard",
            "authoring_actions": ["setup_agent"],
        }
    )


def test_is_protected_create_agent_path_matches_runtime_roots():
    assert is_protected_create_agent_path("/mnt/user-data/agents/dev/demo/AGENTS.md")
    assert is_protected_create_agent_path("/mnt/user-data/authoring/agents/demo/AGENTS.md")
    assert is_protected_create_agent_path("/mnt/user-data/authoring/skills/demo/SKILL.md")
    assert not is_protected_create_agent_path("/mnt/user-data/workspace/demo.md")


def test_uses_forbidden_create_agent_host_path_matches_host_roots():
    assert uses_forbidden_create_agent_host_path("/app/skills/bootstrap")
    assert uses_forbidden_create_agent_host_path("find /app -type d")
    assert uses_forbidden_create_agent_host_path("/agents/dev/demo/AGENTS.md")
    assert uses_forbidden_create_agent_host_path("find /mnt -name '*.md'")
    assert uses_forbidden_create_agent_host_path("ls -la /mnt/user-data/agentz")
    assert uses_forbidden_create_agent_host_path(".openagents/agents/dev/demo")
    assert uses_forbidden_create_agent_host_path("~/.agents/skills/bootstrap")
    assert not uses_forbidden_create_agent_host_path("/mnt/user-data/agents/dev/demo")
    assert not uses_forbidden_create_agent_host_path(
        "find /mnt/skills/store -name 'SKILL.md'",
        allow_skill_library_reads=True,
    )
    assert not uses_forbidden_create_agent_host_path("find /mnt/user-data -name '*.md' 2>/dev/null")


def test_is_read_only_create_agent_shell_command_allows_inspection_pipelines():
    assert is_read_only_create_agent_shell_command("ls -la /mnt/user-data/agents/dev/demo")
    assert is_read_only_create_agent_shell_command(
        "find /mnt/user-data/authoring/agents -type f 2>/dev/null | head -20"
    )
    assert is_read_only_create_agent_shell_command(
        "sed -n '1,40p' /mnt/user-data/agents/dev/demo/AGENTS.md"
    )
    assert not is_read_only_create_agent_shell_command("mkdir -p /mnt/user-data/agents/dev/demo")
    assert not is_read_only_create_agent_shell_command(
        "cat /tmp/template > /mnt/user-data/agents/dev/demo/AGENTS.md"
    )


def test_blocked_create_agent_tool_message_blocks_direct_agent_file_writes():
    request = _tool_request(
        "write_file",
        args={"file_path": "/mnt/user-data/agents/dev/demo/AGENTS.md"},
        context={"command_name": "create-agent"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "setup_agent" in blocked.content


def test_blocked_self_agent_persistence_tool_message_blocks_runtime_agents_md_mutation():
    request = _tool_request(
        "edit_file",
        args={"file_path": "/mnt/user-data/agents/dev/demo-agent/AGENTS.md"},
        context={"agent_name": "demo-agent", "agent_status": "dev"},
    )

    blocked = blocked_self_agent_persistence_tool_message(request)

    assert blocked is not None
    assert "setup_agent" in blocked.content


def test_blocked_self_agent_persistence_tool_message_allows_workspace_edits():
    request = _tool_request(
        "edit_file",
        args={"file_path": "/mnt/user-data/workspace/report.md"},
        context={"agent_name": "demo-agent", "agent_status": "dev"},
    )

    blocked = blocked_self_agent_persistence_tool_message(request)

    assert blocked is None


def test_blocked_self_agent_persistence_tool_message_blocks_shell_mutation_of_current_agent_root():
    request = _tool_request(
        "execute",
        args={"command": "cp /tmp/new.md /mnt/user-data/agents/dev/demo-agent/AGENTS.md"},
        context={"agent_name": "demo-agent", "agent_status": "dev"},
    )

    blocked = blocked_self_agent_persistence_tool_message(request)

    assert blocked is not None
    assert "setup_agent" in blocked.content


def test_blocked_create_agent_tool_message_blocks_shell_commands_touching_agent_roots():
    request = _tool_request(
        "execute",
        args={"command": "mkdir -p /mnt/user-data/authoring/agents/demo"},
        context={"command_name": "create-agent"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "setup_agent" in blocked.content


def test_blocked_create_agent_tool_message_allows_read_only_shell_inspection_on_agent_roots():
    request = _tool_request(
        "execute",
        args={"command": "ls -la /mnt/user-data/agents/dev/demo"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is None


def test_blocked_create_agent_tool_message_blocks_host_path_shell_discovery():
    request = _tool_request(
        "execute",
        args={"command": "find /app -type d -name '*landing*'"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "/mnt/user-data" in blocked.content


def test_blocked_create_agent_tool_message_blocks_host_path_glob_reads():
    request = _tool_request(
        "glob",
        args={"path": "/app", "pattern": "/app/skills/*"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "/mnt/user-data" in blocked.content


def test_blocked_create_agent_tool_message_allows_runtime_glob_brace_patterns():
    request = _tool_request(
        "glob",
        args={"pattern": "/mnt/user-data/agents/{dev,prod}/**/landing-copy-agent-0318/**"},
        context={"command_name": "create-agent", "target_agent_name": "landing-copy-agent-0318"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is None


def test_blocked_create_agent_tool_message_blocks_noncanonical_runtime_glob_prefix():
    request = _tool_request(
        "glob",
        args={"pattern": "/mnt/user-data/agentz/{dev,prod}/**/landing-copy-agent-0318/**"},
        context={"command_name": "create-agent", "target_agent_name": "landing-copy-agent-0318"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "/mnt/user-data/agentz" in blocked.content


def test_blocked_create_agent_tool_message_blocks_reads_outside_runtime_contract():
    request = _tool_request(
        "read_file",
        args={"file_path": "/agents/dev/lead_agent/AGENTS.md"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "/mnt/user-data" in blocked.content


def test_blocked_create_agent_tool_message_blocks_raw_mnt_shell_discovery():
    request = _tool_request(
        "execute",
        args={"command": "find /mnt -name '*landing*' 2>/dev/null | head -20"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "/mnt/user-data" in blocked.content


def test_blocked_create_agent_tool_message_allows_ls_on_archived_skill_store():
    request = _tool_request(
        "ls",
        args={"path": "/mnt/skills/store"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is None


def test_blocked_create_agent_tool_message_allows_read_file_on_archived_skill_store():
    request = _tool_request(
        "read_file",
        args={"file_path": "/mnt/skills/store/prod/find-skills/SKILL.md"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is None


def test_blocked_create_agent_tool_message_still_blocks_skill_store_shell_mutation():
    request = _tool_request(
        "execute",
        args={"command": "cp /tmp/demo.md /mnt/skills/store/dev/demo/SKILL.md"},
        context={"command_name": "create-agent", "target_agent_name": "demo"},
    )

    blocked = blocked_create_agent_tool_message(request)

    assert blocked is not None
    assert "/mnt/skills/store" in blocked.content


def test_filter_create_agent_model_tools_removes_direct_file_mutation_tools():
    filtered = filter_create_agent_model_tools(
        [_tool("read_file"), _tool("write_file"), _tool("edit_file"), _tool("setup_agent")]
    )

    assert [tool.name for tool in filtered] == ["read_file", "setup_agent"]


def test_filter_direct_authoring_model_tools_keeps_only_authoring_and_helper_tools():
    filtered = filter_direct_authoring_model_tools(
        [
            _tool("push_skill_prod"),
            _tool("execute"),
            _tool("read_file"),
            _tool("question"),
            _tool("present_files"),
        ],
        runtime_context={"command_kind": "hard", "authoring_actions": ["push_skill_prod"]},
    )

    assert [tool.name for tool in filtered] == [
        "push_skill_prod",
        "question",
        "present_files",
    ]


def test_blocked_direct_authoring_tool_message_blocks_shell_workarounds():
    request = _tool_request(
        "execute",
        args={"command": "cp -r /mnt/user-data/.openagents/skills/store/dev/demo /mnt/user-data/.openagents/skills/store/prod/demo"},
        context={
            "command_name": "push-skill-prod",
            "command_kind": "hard",
            "authoring_actions": ["push_skill_prod"],
        },
    )

    blocked = blocked_direct_authoring_tool_message(request)

    assert blocked is not None
    assert "push_skill_prod" in blocked.content


def test_blocked_direct_authoring_tool_message_allows_matching_authoring_tool():
    request = _tool_request(
        "push_skill_prod",
        args={"skill_name": "demo"},
        context={
            "command_name": "push-skill-prod",
            "command_kind": "hard",
            "authoring_actions": ["push_skill_prod"],
        },
    )

    blocked = blocked_direct_authoring_tool_message(request)

    assert blocked is None


def test_build_openagents_middlewares_includes_authoring_guard():
    middlewares = lead_agent_module._build_openagents_middlewares(_model())

    assert any(isinstance(middleware, AuthoringGuardMiddleware) for middleware in middlewares)
    assert any(isinstance(middleware, RuntimeCommandMiddleware) for middleware in middlewares)
