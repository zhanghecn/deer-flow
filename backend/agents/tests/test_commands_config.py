from src.config.commands_config import (
    load_common_command_definition,
    resolve_runtime_command,
)
from src.config.paths import Paths


def test_load_common_command_definition_reads_frontmatter_and_template(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    command_file = paths.common_command_file("create-agent")
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_file.write_text(
        """---
name: create-agent
kind: soft
description: 创建智能体
authoring_actions: []
---

用户需求：
{{user_text}}
""",
        encoding="utf-8",
    )

    command = load_common_command_definition("create-agent", paths=paths)

    assert command is not None
    assert command.name == "create-agent"
    assert command.kind == "soft"
    assert command.description == "创建智能体"
    assert command.authoring_actions == ()
    assert "{{user_text}}" in command.template


def test_resolve_runtime_command_prefers_backend_definition_and_infers_target_agent_name(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    command_file = paths.common_command_file("create-agent")
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_file.write_text(
        """---
name: create-agent
kind: soft
description: 创建智能体
authoring_actions: []
---

你现在开始一个 agent 创作任务。
用户需求：
{{user_text}}
""",
        encoding="utf-8",
    )

    command = resolve_runtime_command(
        command_name=None,
        command_kind="hard",
        command_args=None,
        authoring_actions=("save_agent_to_store",),
        original_user_input="/create-agent 请帮我创建一个名为 contract-counsel 的智能体",
        target_agent_name=None,
        paths=paths,
    )

    assert command.name == "create-agent"
    assert command.kind == "soft"
    assert command.args == "请帮我创建一个名为 contract-counsel 的智能体"
    assert command.authoring_actions == ()
    assert command.target_agent_name == "contract-counsel"
    assert command.prompt is not None
    assert "contract-counsel" in command.prompt
