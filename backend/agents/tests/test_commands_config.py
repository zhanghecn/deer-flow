from pathlib import Path

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


def test_resolve_runtime_command_prefers_backend_definition_without_inferring_target_agent_name(tmp_path):
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
        command_args=None,
        original_user_input="/create-agent 请帮我创建一个名为 contract-counsel 的智能体",
        target_agent_name=None,
        paths=paths,
    )

    assert command.name == "create-agent"
    assert command.kind == "soft"
    assert command.args == "请帮我创建一个名为 contract-counsel 的智能体"
    assert command.authoring_actions == ()
    assert command.target_agent_name is None
    assert command.prompt is not None
    assert "contract-counsel" in command.prompt


def test_resolve_runtime_command_preserves_explicit_target_agent_name(tmp_path):
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
        command_args=None,
        original_user_input="/create-agent 请修复已有 dev agent `landing-copy-agent-0318`，不要新建新的 agent",
        target_agent_name="landing-copy-agent-0318",
        paths=paths,
    )

    assert command.name == "create-agent"
    assert command.target_agent_name == "landing-copy-agent-0318"


def test_resolve_runtime_command_keeps_publish_command_as_routing_only(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    command_file = paths.common_command_file("push-skill-prod")
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_file.write_text(
        """---
name: push-skill-prod
kind: hard
description: 发布技能
authoring_actions:
  - push_skill_prod
---

请发布 skill。
用户需求：
{{user_text}}
""",
        encoding="utf-8",
    )

    command = resolve_runtime_command(
        command_name=None,
        command_args=None,
        original_user_input='/push-skill-prod 请把 dev skill oa-test-se-code-20260320 推送到 prod，必要时直接调用 push_skill_prod(skill_name="oa-test-se-code-20260320")。',
        target_agent_name=None,
        paths=paths,
    )

    assert command.name == "push-skill-prod"
    assert command.kind == "hard"
    assert command.authoring_actions == ("push_skill_prod",)


def test_create_agent_command_prompt_documents_runtime_update_constraints():
    repo_root = Path(__file__).resolve().parents[3]
    command_text = (repo_root / ".openagents/commands/common/create-agent.md").read_text(encoding="utf-8")

    assert "kind: soft" in command_text
    assert "find-skills" in command_text
    assert "/mnt/skills/system/skills/..." in command_text
    assert "/mnt/skills/custom/skills/..." in command_text
    assert "本地 archived skill library 优先" in command_text
    assert "不要传 `model` 字段" in command_text
    assert "显式传入 `agent_name`" in command_text
    assert "自己选一个简短 kebab-case 名称" in command_text
    assert "setup_agent" in command_text
