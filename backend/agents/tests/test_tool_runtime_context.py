from pathlib import Path, PurePosixPath
from types import SimpleNamespace

import yaml
from langchain_core.messages import HumanMessage

from src.agents.lead_agent.agent import LeadAgentRuntimeContext
from src.config.paths import Paths
from src.tools.builtins.authoring_persistence import (
    RegistryInstalledSkill,
    RegistrySkillInstallResult,
    RegistrySkippedSkill,
)
from src.tools.builtins.install_skill_from_registry_tool import install_skill_from_registry
from src.tools.builtins.push_agent_prod_tool import push_agent_prod
from src.tools.builtins.push_skill_prod_tool import push_skill_prod
from src.tools.builtins.runtime_context import runtime_context_value
from src.tools.builtins.save_agent_to_store_tool import save_agent_to_store
from src.tools.builtins.save_skill_to_store_tool import save_skill_to_store
from src.tools.builtins.setup_agent_tool import SetupAgentSkillInput, setup_agent


def test_runtime_context_value_supports_typed_context():
    context = LeadAgentRuntimeContext(
        agent_name="lead_agent",
        target_agent_name="contract-agent",
        agent_status="dev",
        runtime_thread_id="thread-1",
    )

    assert runtime_context_value(context, "agent_name") == "lead_agent"
    assert runtime_context_value(context, "target_agent_name") == "contract-agent"
    assert runtime_context_value(context, "agent_status") == "dev"
    assert runtime_context_value(context, "x-thread-id") == "thread-1"
    assert runtime_context_value(context, "missing", "fallback") == "fallback"


def test_setup_agent_skill_input_schema_preserves_inline_skill_content():
    """Inline agent-owned skills must reach setup_agent instead of degrading to name-only refs."""

    skill = SetupAgentSkillInput(
        name="bms-kb-answering",
        content="---\nname: bms-kb-answering\ndescription: BMS KB answering\n---\n\n# BMS\n",
    )

    assert skill.name == "bms-kb-answering"
    assert skill.content.startswith("---\nname: bms-kb-answering")
    assert "content" in SetupAgentSkillInput.model_fields
    assert "source_path" in SetupAgentSkillInput.model_fields


def test_save_skill_to_store_requires_explicit_skill_name(monkeypatch):
    calls: dict[str, object] = {}

    monkeypatch.setattr(
        "src.tools.builtins.save_skill_to_store_tool.get_paths",
        lambda: SimpleNamespace(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.save_skill_to_store_tool.resolve_default_skill_source_dir",
        lambda **kwargs: Path("/tmp/source-skill"),
    )

    def fake_save_skill_directory_to_store(**kwargs):
        calls.update(kwargs)
        return Path("/tmp/store/dev/contract-skill"), None

    monkeypatch.setattr(
        "src.tools.builtins.save_skill_to_store_tool.save_skill_directory_to_store",
        fake_save_skill_directory_to_store,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            runtime_thread_id="thread-1",
        ),
        tool_call_id="tc-skill-save",
    )

    command = save_skill_to_store.func(runtime=runtime, skill_name="contract-skill")

    assert calls["skill_name"] == "contract-skill"
    assert command.update["messages"][0].content.startswith("Skill 'contract-skill' saved")


def test_save_skill_to_store_resolves_thread_id_from_typed_runtime_context(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    calls: dict[str, object] = {}

    monkeypatch.setattr(
        "src.tools.builtins.save_skill_to_store_tool.get_paths",
        lambda: paths,
    )

    def fake_save_skill_directory_to_store(**kwargs):
        calls.update(kwargs)
        return paths.store_dev_skills_dir / "contract-skill", None

    monkeypatch.setattr(
        "src.tools.builtins.save_skill_to_store_tool.save_skill_directory_to_store",
        fake_save_skill_directory_to_store,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            runtime_thread_id="thread-typed",
        ),
        state={},
        tool_call_id="tc-skill-save-thread",
    )

    save_skill_to_store.func(runtime=runtime, skill_name="contract-skill")

    assert calls["skill_name"] == "contract-skill"
    assert calls["source_dir"] == paths.sandbox_authoring_skills_dir("thread-typed") / "contract-skill"


def test_push_skill_prod_requires_explicit_skill_name(monkeypatch):
    calls: dict[str, object] = {}

    monkeypatch.setattr(
        "src.tools.builtins.push_skill_prod_tool.get_paths",
        lambda: SimpleNamespace(),
    )

    def fake_push_skill_directory_to_prod(skill_name: str, *, paths: object):
        calls["skill_name"] = skill_name
        calls["paths"] = paths
        return Path("/tmp/store/prod/contract-skill"), None

    monkeypatch.setattr(
        "src.tools.builtins.push_skill_prod_tool.push_skill_directory_to_prod",
        fake_push_skill_directory_to_prod,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            runtime_thread_id="thread-1",
        ),
        tool_call_id="tc-skill-push",
    )

    command = push_skill_prod.func(runtime=runtime, skill_name="contract-skill")

    assert calls["skill_name"] == "contract-skill"
    assert command.update["messages"][0].content.startswith("Skill 'contract-skill' pushed")


def test_save_skill_to_store_tool_exposes_docstring_arg_descriptions():
    schema = save_skill_to_store.args

    assert schema["skill_name"]["description"].startswith("Required skill name")
    assert "runtime draft directory" in schema["source_path"]["description"]


def test_setup_agent_tool_exposes_docstring_arg_descriptions():
    schema = setup_agent.args

    assert "Full AGENTS.md markdown content" in schema["agents_md"]["description"]
    assert "When updating an existing archived agent" in schema["agents_md"]["description"]
    assert "When updating an existing archived agent" in schema["description"]["description"]
    assert "Required when the current runtime" in schema["agent_name"]["description"]
    assert "must still choose one explicitly" in schema["agent_name"]["description"]
    assert "source_path" in schema["skills"]["description"]


def test_setup_agent_accepts_typed_runtime_context(monkeypatch):
    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: SimpleNamespace(
            custom_agent_dir=lambda name, status: Path(f"/tmp/{status}/{name}"),
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="glm-5",
            user_id="user-123",
        ),
        tool_call_id="tc-1",
    )

    command = setup_agent.func(
        agents_md="# Contract Agent",
        description="Reviews contracts",
        runtime=runtime,
        agent_name="contract-agent",
        skills=[
            {"name": "bootstrap"},
            {
                "name": "contract-review",
                "content": "---\nname: contract-review\ndescription: Review contracts\n---\n\n# contract-review\n",
            },
        ],
    )

    assert calls["name"] == "contract-agent"
    assert calls["status"] == "dev"
    assert calls["owner_user_id"] == "user-123"
    assert calls["description"] == "Reviews contracts"
    assert calls["model"] == "glm-5"
    assert calls["skill_refs"] == [{"name": "bootstrap"}]
    assert calls["inline_skills"] == [
        {
            "name": "contract-review",
            "content": "---\nname: contract-review\ndescription: Review contracts\n---\n\n# contract-review\n",
        }
    ]
    assert command.update["created_agent_name"] == "contract-agent"
    assert 'task(subagent_type="contract-agent", description="short label", prompt="full task briefing")' in command.update["messages"][0].content


def test_setup_agent_falls_back_to_thread_owner_when_runtime_user_id_is_missing(monkeypatch):
    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: SimpleNamespace(
            custom_agent_dir=lambda name, status: Path(f"/tmp/{status}/{name}"),
        ),
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_runtime_db_store",
        lambda: SimpleNamespace(get_thread_owner=lambda thread_id: "thread-owner-1"),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="glm-5",
            runtime_thread_id="thread-1",
        ),
        tool_call_id="tc-thread-owner-fallback",
    )

    setup_agent.func(
        agents_md="# Contract Agent",
        description="Reviews contracts",
        runtime=runtime,
        agent_name="contract-agent",
    )

    assert calls["owner_user_id"] == "thread-owner-1"


def test_setup_agent_preserves_existing_owner_when_runtime_owner_is_missing(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    agent_dir = paths.custom_agent_dir("owned-agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("# Owned Agent", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        "name: owned-agent\n"
        "description: Existing owner\n"
        "status: dev\n"
        "owner_user_id: owner-1\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs: []\n"
        "memory:\n"
        "  enabled: false\n"
        "subagent_defaults:\n"
        "  general_purpose_enabled: true\n",
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_runtime_db_store",
        lambda: SimpleNamespace(get_thread_owner=lambda thread_id: None),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="glm-5",
        ),
        tool_call_id="tc-preserve-owner",
    )

    setup_agent.func(
        agents_md="# Owned Agent",
        description="Updated description",
        runtime=runtime,
        agent_name="owned-agent",
    )

    assert calls["owner_user_id"] == "owner-1"


def test_setup_agent_does_not_overwrite_existing_owner_with_different_runtime_user(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    agent_dir = paths.custom_agent_dir("owned-agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("# Owned Agent", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        "name: owned-agent\n"
        "description: Existing owner\n"
        "status: dev\n"
        "owner_user_id: owner-1\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs: []\n"
        "memory:\n"
        "  enabled: false\n"
        "subagent_defaults:\n"
        "  general_purpose_enabled: true\n",
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="glm-5",
            user_id="owner-2",
        ),
        tool_call_id="tc-keep-existing-owner",
    )

    setup_agent.func(
        agents_md="# Owned Agent",
        description="Updated description",
        runtime=runtime,
        agent_name="owned-agent",
    )

    assert calls["owner_user_id"] == "owner-1"


def test_setup_agent_missing_agent_name_returns_recovery_hint():
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-missing-agent-name",
    )

    command = setup_agent.func(
        agents_md="# PR Review Agent\n",
        description="Reviews pull requests",
        runtime=runtime,
        skills=[{"source_path": "system/skills/pr-review"}],
    )

    message = command.update["messages"][0].content
    assert "requires explicit `agent_name`" in message
    assert "choose a short descriptive kebab-case" in message
    assert 'setup_agent(agent_name="pr-review-agent"' in message


def test_setup_agent_missing_agent_name_uses_structured_target_name_in_recovery_hint():
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="kimi-k2.5",
            target_agent_name="contract-review-agent",
            command_name="create-agent",
        ),
        tool_call_id="tc-missing-agent-name-targeted",
    )

    command = setup_agent.func(
        agents_md="# Contract Review Agent\n",
        description="Reviews contracts",
        runtime=runtime,
        skills=[{"source_path": "system/skills/pr-review"}],
    )

    message = command.update["messages"][0].content
    assert 'target_agent_name="contract-review-agent"' in message
    assert 'setup_agent(agent_name="contract-review-agent"' in message


def test_setup_agent_invalid_source_path_suggests_exact_available_source(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: SimpleNamespace(
            skills_dir=Path("/tmp/skills"),
            custom_agent_dir=lambda name, status: Path(f"/tmp/{status}/{name}"),
        ),
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.load_skills",
        lambda **kwargs: [SimpleNamespace(name="openpencil-design")],
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.skill_source_path",
        lambda skill: "custom/skills/openpencil-design",
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-invalid-source-path",
    )

    command = setup_agent.func(
        agents_md="# OpenPencil Design Agent\n",
        description="Creates OpenPencil design drafts",
        runtime=runtime,
        agent_name="openpencil-design-agent",
        skills=[{"source_path": "system/skills/openpencil-design"}],
    )

    message = command.update["messages"][0].content
    assert "system/skills/openpencil-design" in message
    assert "custom/skills/openpencil-design" in message
    assert "Retry with one of those exact values." in message


def test_setup_agent_preserves_existing_agent_owned_skill_from_thread_runtime(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    runtime_agent_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "landing-copy-agent-0318"
    runtime_skill_dir = runtime_agent_dir / "skills" / "saas-landing-copywriter"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    (runtime_skill_dir / "SKILL.md").write_text(
        "---\nname: saas-landing-copywriter\ndescription: Writes SaaS landing page copy.\n---\n\n# saas-landing-copywriter\n",
        encoding="utf-8",
    )
    (runtime_agent_dir / "config.yaml").write_text(
        yaml.dump(
            {
                "name": "landing-copy-agent-0318",
                "status": "dev",
                "agents_md_path": "AGENTS.md",
                "skill_refs": [
                    {
                        "name": "saas-landing-copywriter",
                        "materialized_path": "skills/saas-landing-copywriter",
                    }
                ],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="landing-copy-agent-0318",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5-1",
        ),
        tool_call_id="tc-restore",
    )

    setup_agent.func(
        agents_md="# Landing Copy Agent",
        description="Writes SaaS landing pages",
        runtime=runtime,
        agent_name="landing-copy-agent-0318",
        skills=[{"name": "saas-landing-copywriter"}],
    )

    assert calls["skill_refs"] == []
    assert calls["inline_skills"] == [
        {
            "name": "saas-landing-copywriter",
            "content": "---\nname: saas-landing-copywriter\ndescription: Writes SaaS landing page copy.\n---\n\n# saas-landing-copywriter\n",
        }
    ]


def test_setup_agent_name_only_skill_preserves_existing_source_path(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    archive_agent_dir = paths.custom_agent_dir("op-design-agent", "dev")
    archive_skill_dir = archive_agent_dir / "skills" / "openpencil-design"
    archive_skill_dir.mkdir(parents=True, exist_ok=True)
    (archive_skill_dir / "SKILL.md").write_text(
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# openpencil-design\n",
        encoding="utf-8",
    )
    (archive_agent_dir / "config.yaml").write_text(
        yaml.dump(
            {
                "name": "op-design-agent",
                "status": "dev",
                "agents_md_path": "AGENTS.md",
                "skill_refs": [
                    {
                        "name": "openpencil-design",
                        "source_path": "custom/skills/openpencil-design",
                    }
                ],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="op-design-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-preserve-source-path",
    )

    setup_agent.func(
        agents_md="# OpenPencil Design Agent\n",
        description="Creates design drafts",
        runtime=runtime,
        agent_name="op-design-agent",
        skills=[{"name": "openpencil-design"}],
    )

    assert calls["skill_refs"] == [
        {
            "name": "openpencil-design",
            "source_path": "custom/skills/openpencil-design",
        }
    ]
    assert calls["inline_skills"] == []


def test_setup_agent_matching_source_path_preserves_runtime_edited_copied_skill(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    archive_agent_dir = paths.custom_agent_dir("op-design-agent", "dev")
    archive_skill_dir = archive_agent_dir / "skills" / "openpencil-design"
    archive_skill_dir.mkdir(parents=True, exist_ok=True)
    archived_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# archived-openpencil-design\n"
    )
    (archive_skill_dir / "SKILL.md").write_text(archived_content, encoding="utf-8")
    config_payload = {
        "name": "op-design-agent",
        "status": "dev",
        "agents_md_path": "AGENTS.md",
        "skill_refs": [
            {
                "name": "openpencil-design",
                "source_path": "custom/skills/openpencil-design",
            }
        ],
    }
    (archive_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    runtime_agent_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "op-design-agent"
    runtime_skill_dir = runtime_agent_dir / "skills" / "openpencil-design"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    edited_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# edited-openpencil-design\n"
    )
    (runtime_skill_dir / "SKILL.md").write_text(edited_content, encoding="utf-8")
    (runtime_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="op-design-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-edited-copied-skill",
    )

    setup_agent.func(
        agents_md="# OpenPencil Design Agent\n",
        description="Creates design drafts",
        runtime=runtime,
        agent_name="op-design-agent",
        skills=[{"name": "openpencil-design", "source_path": "custom/skills/openpencil-design"}],
    )

    assert calls["skill_refs"] == []
    assert calls["inline_skills"] == [
        {
            "name": "openpencil-design",
            "content": edited_content,
        }
    ]


def test_setup_agent_duplicate_skill_entries_preserve_runtime_edited_copied_skill(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    archive_agent_dir = paths.custom_agent_dir("op-design-agent", "dev")
    archive_skill_dir = archive_agent_dir / "skills" / "openpencil-design"
    archive_skill_dir.mkdir(parents=True, exist_ok=True)
    archived_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# archived-openpencil-design\n"
    )
    (archive_skill_dir / "SKILL.md").write_text(archived_content, encoding="utf-8")
    config_payload = {
        "name": "op-design-agent",
        "status": "dev",
        "agents_md_path": "AGENTS.md",
        "skill_refs": [
            {
                "name": "openpencil-design",
                "source_path": "custom/skills/openpencil-design",
            }
        ],
    }
    (archive_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    runtime_agent_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "op-design-agent"
    runtime_skill_dir = runtime_agent_dir / "skills" / "openpencil-design"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    edited_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# edited-openpencil-design\n"
    )
    (runtime_skill_dir / "SKILL.md").write_text(edited_content, encoding="utf-8")
    (runtime_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="op-design-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-edited-copied-skill-duplicate-entries",
    )

    setup_agent.func(
        agents_md="# OpenPencil Design Agent\n",
        description="Creates design drafts",
        runtime=runtime,
        agent_name="op-design-agent",
        skills=[
            {"name": "openpencil-design", "source_path": "custom/skills/openpencil-design"},
            {"name": "openpencil-design"},
        ],
    )

    assert calls["skill_refs"] == []
    assert calls["inline_skills"] == [
        {
            "name": "openpencil-design",
            "content": edited_content,
        }
    ]


def test_setup_agent_uses_config_thread_id_for_runtime_edited_copied_skill(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    archive_agent_dir = paths.custom_agent_dir("op-design-agent", "dev")
    archive_skill_dir = archive_agent_dir / "skills" / "openpencil-design"
    archive_skill_dir.mkdir(parents=True, exist_ok=True)
    archived_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# archived-openpencil-design\n"
    )
    (archive_skill_dir / "SKILL.md").write_text(archived_content, encoding="utf-8")
    config_payload = {
        "name": "op-design-agent",
        "status": "dev",
        "agents_md_path": "AGENTS.md",
        "skill_refs": [
            {
                "name": "openpencil-design",
                "source_path": "custom/skills/openpencil-design",
            }
        ],
    }
    (archive_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    runtime_agent_dir = paths.sandbox_agents_dir("thread-from-config") / "dev" / "op-design-agent"
    runtime_skill_dir = runtime_agent_dir / "skills" / "openpencil-design"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    edited_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# edited-openpencil-design\n"
    )
    (runtime_skill_dir / "SKILL.md").write_text(edited_content, encoding="utf-8")
    (runtime_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="op-design-agent",
            agent_status="dev",
            model_name="kimi-k2.5",
        ),
        config={"configurable": {"thread_id": "thread-from-config"}},
        tool_call_id="tc-edited-copied-skill-config-thread-id",
    )

    setup_agent.func(
        agents_md="# OpenPencil Design Agent\n",
        description="Creates design drafts",
        runtime=runtime,
        agent_name="op-design-agent",
        skills=[
            {"name": "openpencil-design", "source_path": "custom/skills/openpencil-design"},
            {"name": "openpencil-design", "source_path": "custom/skills/openpencil-design"},
        ],
    )

    assert calls["skill_refs"] == []
    assert calls["inline_skills"] == [
        {
            "name": "openpencil-design",
            "content": edited_content,
        }
    ]


def test_setup_agent_preserves_existing_agent_manifest_fields_when_omitted(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    agent_dir = paths.custom_agent_dir("op-design-agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("# Existing Agent\n", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        yaml.dump(
            {
                "name": "op-design-agent",
                "status": "dev",
                "description": "Existing description",
                "model": "kimi-k2.5",
                "tool_groups": ["design"],
                "tool_names": ["read_file", "write_file"],
                "mcp_servers": ["figma"],
                "memory": {
                    "enabled": True,
                    "model_name": "kimi-k2.5",
                    "debounce_seconds": 15,
                },
                "subagent_defaults": {
                    "general_purpose_enabled": False,
                    "tool_names": ["read_file"],
                },
                "agents_md_path": "AGENTS.md",
                "skill_refs": [],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (agent_dir / "subagents.yaml").write_text(
        yaml.dump(
            {
                "version": 1,
                "subagents": {
                    "designer-helper": {
                        "description": "Existing helper",
                        "system_prompt": "Keep layouts consistent.",
                        "tool_names": ["read_file"],
                    }
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[], name="op-design-agent")

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="op-design-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-preserve-manifest",
    )

    setup_agent.func(
        runtime=runtime,
        skills=[],
    )

    assert calls["agents_md"] == "# Existing Agent"
    assert calls["description"] == "Existing description"
    assert calls["tool_groups"] == ["design"]
    assert calls["tool_names"] == ["read_file", "write_file"]
    assert calls["mcp_servers"] == ["figma"]
    assert calls["memory"].enabled is True
    assert calls["memory"].debounce_seconds == 15
    assert calls["subagent_defaults"].general_purpose_enabled is False
    assert calls["subagents"][0].name == "designer-helper"


def test_setup_agent_allows_explicit_mcp_binding_override(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    agent_dir = paths.custom_agent_dir("support-agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("# Support Agent\n", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        yaml.dump(
            {
                "name": "support-agent",
                "status": "dev",
                "description": "Existing description",
                "mcp_servers": ["custom/mcp-profiles/old.json"],
                "agents_md_path": "AGENTS.md",
                "skill_refs": [],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[], name="support-agent")

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="support-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-explicit-mcp-override",
    )

    setup_agent.func(
        runtime=runtime,
        mcp_servers=["custom/mcp-profiles/customer-docs.json"],
        skills=[],
    )

    assert calls["mcp_servers"] == ["custom/mcp-profiles/customer-docs.json"]


def test_setup_agent_writes_mcp_profile_and_binds_it(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[], name="support-agent")

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool._refresh_thread_runtime_materials",
        lambda **kwargs: None,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-create-mcp-profile-and-bind",
    )

    setup_agent.func(
        runtime=runtime,
        agent_name="support-agent",
        agents_md="# Support Agent\n",
        description="Answers customer questions",
        mcp_profiles=[
            {
                "name": "customer-docs",
                "config_json": {
                    "mcpServers": {
                        "customer-docs": {
                            "type": "http",
                            "url": "https://customer.example.com/mcp",
                        }
                    }
                },
            }
        ],
        skills=[],
    )

    profile_file = paths.custom_mcp_profile_file("customer-docs.json")
    assert profile_file.exists()
    assert calls["mcp_servers"] == ["custom/mcp-profiles/customer-docs.json"]


def test_setup_agent_requires_agents_md_and_description_for_new_agents():
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-new-agent-missing-fields",
    )

    command = setup_agent.func(
        runtime=runtime,
        agent_name="new-design-agent",
        skills=[],
    )

    message = command.update["messages"][0].content
    assert "requires non-empty `agents_md` and `description` when creating a new agent" in message
    assert "existing archived agent update" in message


def test_setup_agent_refreshes_thread_runtime_files_after_update(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    runtime_agent_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "landing-copy-agent-0318"
    runtime_skill_dir = runtime_agent_dir / "skills" / "saas-landing-copywriter"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    (runtime_agent_dir / "AGENTS.md").write_text(
        "---\nskill_refs:\n  - name: saas-landing-copywriter\n---\n\n# Stale Agent\n",
        encoding="utf-8",
    )
    (runtime_skill_dir / "SKILL.md").write_text(
        "---\nname: saas-landing-copywriter\ndescription: Old copy.\n---\n\n# stale-skill\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    new_agents_md = "# Landing Copy Agent\n\nFresh instructions only.\n"
    new_skill_content = (
        "---\n"
        "name: saas-landing-copywriter\n"
        "description: Updated copywriting skill.\n"
        "---\n\n"
        "# updated-skill\n"
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="landing-copy-agent-0318",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5-1",
        ),
        tool_call_id="tc-sync-runtime",
    )

    command = setup_agent.func(
        agents_md=new_agents_md,
        description="Writes SaaS landing pages",
        runtime=runtime,
        agent_name="landing-copy-agent-0318",
        skills=[
            {
                "name": "saas-landing-copywriter",
                "content": new_skill_content,
            }
        ],
    )

    archive_agent_dir = paths.custom_agent_dir("landing-copy-agent-0318", "dev")
    assert (archive_agent_dir / "AGENTS.md").read_text(encoding="utf-8") == new_agents_md
    assert (runtime_agent_dir / "AGENTS.md").read_text(encoding="utf-8") == new_agents_md
    assert (runtime_skill_dir / "SKILL.md").read_text(encoding="utf-8") == new_skill_content
    assert command.update["created_agent_name"] == "landing-copy-agent-0318"


def test_setup_agent_omits_task_handoff_hint_for_self_update(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="demo-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5-1",
        ),
        tool_call_id="tc-self-update-no-task-hint",
    )

    command = setup_agent.func(
        agents_md="# Demo Agent\n\nUpdated instructions.\n",
        description="Does demo work",
        runtime=runtime,
        skills=[],
    )

    message = command.update["messages"][0].content
    assert "Agent 'demo-agent' created successfully!" in message
    assert "task(subagent_type=" not in message


def test_setup_agent_refreshes_thread_runtime_files_with_thread_id_only_context(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    runtime_agent_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "landing-copy-agent-0318"
    runtime_skill_dir = runtime_agent_dir / "skills" / "saas-landing-copywriter"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    (runtime_agent_dir / "AGENTS.md").write_text(
        "# stale agent\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context={
            "target_agent_name": "landing-copy-agent-0318",
            "agent_status": "dev",
            "thread_id": "thread-1",
            "model_name": "kimi-k2.5-1",
        },
        tool_call_id="tc-thread-id-only",
    )

    new_skill_content = (
        "---\n"
        "name: saas-landing-copywriter\n"
        "description: Updated copywriting skill.\n"
        "---\n\n"
        "# updated-skill\n"
    )

    setup_agent.func(
        agents_md="# Landing Copy Agent\n\nFresh instructions only.\n",
        description="Writes SaaS landing pages",
        runtime=runtime,
        agent_name="landing-copy-agent-0318",
        skills=[
            {
                "name": "saas-landing-copywriter",
                "content": new_skill_content,
            }
        ],
    )

    assert (runtime_agent_dir / "config.yaml").is_file()
    assert (runtime_agent_dir / "AGENTS.md").read_text(encoding="utf-8") == "# Landing Copy Agent\n\nFresh instructions only.\n"
    assert (runtime_skill_dir / "SKILL.md").read_text(encoding="utf-8") == new_skill_content


def test_setup_agent_omitted_skills_preserves_existing_archive_skills(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    archive_agent_dir = paths.custom_agent_dir("landing-copy-agent-0318", "dev")
    archive_skill_dir = archive_agent_dir / "skills" / "saas-landing-copywriter"
    archive_skill_dir.mkdir(parents=True, exist_ok=True)
    (archive_skill_dir / "SKILL.md").write_text(
        "---\nname: saas-landing-copywriter\ndescription: Preserved archive copy.\n---\n\n# preserved-skill\n",
        encoding="utf-8",
    )
    (archive_agent_dir / "config.yaml").write_text(
        yaml.dump(
            {
                "name": "landing-copy-agent-0318",
                "status": "dev",
                "agents_md_path": "AGENTS.md",
                "skill_refs": [
                    {
                        "name": "saas-landing-copywriter",
                        "source_path": "store/dev/saas-landing-copywriter",
                    }
                ],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(agents_md_path="AGENTS.md", skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="landing-copy-agent-0318",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5-1",
        ),
        tool_call_id="tc-preserve-skills",
    )

    setup_agent.func(
        agents_md="# Landing Copy Agent\n\nPreserve existing skills.\n",
        description="Writes SaaS landing pages",
        runtime=runtime,
        agent_name="landing-copy-agent-0318",
    )

    assert calls["skill_refs"] == [
        {
            "name": "saas-landing-copywriter",
            "source_path": "store/dev/saas-landing-copywriter",
        }
    ]
    assert calls["inline_skills"] == []


def test_setup_agent_omitted_skills_preserves_runtime_edited_copied_skill(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    archive_agent_dir = paths.custom_agent_dir("op-design-agent", "dev")
    archive_skill_dir = archive_agent_dir / "skills" / "openpencil-design"
    archive_skill_dir.mkdir(parents=True, exist_ok=True)
    archived_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# archived-openpencil-design\n"
    )
    (archive_skill_dir / "SKILL.md").write_text(archived_content, encoding="utf-8")
    config_payload = {
        "name": "op-design-agent",
        "status": "dev",
        "agents_md_path": "AGENTS.md",
        "skill_refs": [
            {
                "name": "openpencil-design",
                "source_path": "custom/skills/openpencil-design",
            }
        ],
    }
    (archive_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    runtime_agent_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "op-design-agent"
    runtime_skill_dir = runtime_agent_dir / "skills" / "openpencil-design"
    runtime_skill_dir.mkdir(parents=True, exist_ok=True)
    edited_content = (
        "---\nname: openpencil-design\ndescription: Copied OpenPencil workflow.\n---\n\n# edited-openpencil-design\n"
    )
    (runtime_skill_dir / "SKILL.md").write_text(edited_content, encoding="utf-8")
    (runtime_agent_dir / "config.yaml").write_text(
        yaml.dump(config_payload, sort_keys=False),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(agents_md_path="AGENTS.md", skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="op-design-agent",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5",
        ),
        tool_call_id="tc-preserve-edited-omitted-skills",
    )

    setup_agent.func(
        agents_md="# OpenPencil Design Agent\n\nPreserve edited copied skill.\n",
        description="Creates design drafts",
        runtime=runtime,
        agent_name="op-design-agent",
    )

    assert calls["skill_refs"] == []
    assert calls["inline_skills"] == [
        {
            "name": "openpencil-design",
            "content": edited_content,
        }
    ]


def test_setup_agent_forwards_explicit_skill_source_path(monkeypatch):
    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: SimpleNamespace(
            custom_agent_dir=lambda name, status: Path(f"/tmp/{status}/{name}"),
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="contract-agent",
            agent_status="dev",
            model_name="glm-5",
        ),
        tool_call_id="tc-source-path",
    )

    setup_agent.func(
        agents_md="# Contract Agent",
        description="Reviews contracts",
        runtime=runtime,
        agent_name="contract-agent",
        skills=[
            {
                "name": "contract-review",
                "source_path": "store/prod/contracts/review",
            }
        ],
    )

    assert calls["skill_refs"] == [
        {
            "name": "contract-review",
            "source_path": "store/prod/contracts/review",
        }
    ]
    assert calls["inline_skills"] == []


def test_setup_agent_accepts_source_path_without_name(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    skill_dir = paths.skills_dir / "store" / "prod" / "contracts" / "review"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: contract-review\ndescription: Review contracts.\n---\n\n# contract-review\n",
        encoding="utf-8",
    )
    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="contract-agent",
            agent_status="dev",
            model_name="glm-5",
        ),
        tool_call_id="tc-source-path-only",
    )

    setup_agent.func(
        agents_md="# Contract Agent",
        description="Reviews contracts",
        runtime=runtime,
        agent_name="contract-agent",
        skills=[
            {
                "source_path": "store/prod/contracts/review",
            }
        ],
    )

    assert calls["skill_refs"] == [
        {
            "name": "contract-review",
            "source_path": "store/prod/contracts/review",
        }
    ]
    assert calls["inline_skills"] == []


def test_setup_agent_missing_name_only_skill_returns_inline_content_hint(monkeypatch, tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: paths,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            target_agent_name="landing-copy-agent-0318",
            agent_status="dev",
            runtime_thread_id="thread-1",
            model_name="kimi-k2.5-1",
        ),
        tool_call_id="tc-inline-hint",
    )

    result = setup_agent.func(
        agents_md="# Landing Copy Agent\n",
        description="Writes SaaS landing pages",
        runtime=runtime,
        agent_name="landing-copy-agent-0318",
        skills=[{"name": "saas-landing-copywriter"}],
    )

    message = result.update["messages"][0].content
    assert "full SKILL.md" in message
    assert "agent-owned skill" in message
    assert "saas-landing-copywriter" in message


def test_save_and_push_agent_tools_accept_explicit_agent_name(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.save_agent_to_store_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.save_agent_to_store_tool.resolve_default_agent_source_dir",
        lambda runtime, agent_name, paths: f"/tmp/{agent_name}",
    )
    monkeypatch.setattr(
        "src.tools.builtins.save_agent_to_store_tool.save_agent_directory_to_store",
        lambda source_dir, agent_name, paths: (f"/store/dev/{agent_name}", None),
    )
    monkeypatch.setattr(
        "src.tools.builtins.push_agent_prod_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.push_agent_prod_tool.push_agent_directory_to_prod",
        lambda agent_name, paths: (f"/store/prod/{agent_name}", None),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_name="lead_agent"),
        tool_call_id="tc-2",
    )

    save_result = save_agent_to_store.func(runtime=runtime, agent_name="contract-agent")
    push_result = push_agent_prod.func(runtime=runtime, agent_name="contract-agent")

    assert "contract-agent" in save_result.update["messages"][0].content
    assert "contract-agent" in push_result.update["messages"][0].content


def test_install_skill_from_registry_tool_returns_success_message(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.install_registry_skill_to_store",
        lambda source, skill_name, paths: RegistrySkillInstallResult(
            installed_skills=(
                RegistryInstalledSkill(
                    name="copywriting",
                    relative_path=PurePosixPath("copywriting"),
                    target_dir=Path("/store/dev/copywriting"),
                ),
            ),
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev"),
        tool_call_id="tc-3",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source="coreyhaines31/marketingskills@copywriting",
    )

    assert "copywriting" in result


def test_install_skill_from_registry_tool_summarizes_repo_root_install(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.install_registry_skill_to_store",
        lambda source, skill_name, paths: RegistrySkillInstallResult(
            installed_skills=(
                RegistryInstalledSkill(
                    name="alpha-skill",
                    relative_path=PurePosixPath("alpha-skill"),
                    target_dir=Path("/store/dev/alpha-skill"),
                ),
                RegistryInstalledSkill(
                    name="beta-skill",
                    relative_path=PurePosixPath("beta-skill"),
                    target_dir=Path("/store/dev/beta-skill"),
                ),
            ),
            skipped_skills=(
                RegistrySkippedSkill(
                    relative_path=PurePosixPath("gamma-skill"),
                    existing_scopes=("store/prod",),
                ),
            ),
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev"),
        tool_call_id="tc-3-bulk",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source="https://github.com/MiniMax-AI/skills.git",
    )

    assert "Installed 2 skills" in result
    assert "alpha-skill, beta-skill" in result
    assert "gamma-skill (store/prod)" in result


def test_install_skill_from_registry_tool_exposes_source_arg_description():
    assert install_skill_from_registry.args["source"]["description"].startswith("Required registry source")


def test_install_skill_from_registry_tool_infers_unique_explicit_url_from_latest_human_message(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )

    captured: dict[str, object] = {}

    def fake_install_registry_skill_to_store(*, source, skill_name, paths):
        captured["source"] = source
        captured["skill_name"] = skill_name
        return RegistrySkillInstallResult(
            installed_skills=(
                RegistryInstalledSkill(
                    name="alpha-skill",
                    relative_path=PurePosixPath("alpha-skill"),
                    target_dir=Path("/store/dev/alpha-skill"),
                ),
            ),
        )

    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.install_registry_skill_to_store",
        fake_install_registry_skill_to_store,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev"),
        state={
            "messages": [
                HumanMessage(content="从 https://github.com/MiniMax-AI/skills.git 安装里面全部 skills")
            ]
        },
        tool_call_id="tc-registry-fallback",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source="",
    )

    assert captured["source"] == "https://github.com/MiniMax-AI/skills.git"
    assert captured["skill_name"] is None
    assert "alpha-skill" in result


def test_install_skill_from_registry_tool_returns_explicit_error_when_source_missing(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev"),
        state={"messages": [HumanMessage(content="请帮我安装 skills")]},
        tool_call_id="tc-registry-missing-source",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source="",
    )

    assert "source is required" in result
    assert "https://github.com/MiniMax-AI/skills.git" in result


def test_install_skill_from_registry_tool_falls_back_from_malformed_source_to_latest_human_url(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )

    captured: dict[str, object] = {}

    def fake_install_registry_skill_to_store(*, source, skill_name, paths):
        captured["source"] = source
        return RegistrySkillInstallResult(
            installed_skills=(
                RegistryInstalledSkill(
                    name="alpha-skill",
                    relative_path=PurePosixPath("alpha-skill"),
                    target_dir=Path("/store/dev/alpha-skill"),
                ),
            ),
        )

    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.install_registry_skill_to_store",
        fake_install_registry_skill_to_store,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev"),
        state={
            "messages": [
                HumanMessage(content="从 https://github.com/MiniMax-AI/skills.git 安装里面全部 skills")
            ]
        },
        tool_call_id="tc-registry-malformed-source",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source='}  <|tool_calls_section_end|>  执行命令出错了',
    )

    assert captured["source"] == "https://github.com/MiniMax-AI/skills.git"
    assert "alpha-skill" in result


def test_install_skill_from_registry_tool_normalizes_embedded_json_source(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )

    captured: dict[str, object] = {}

    def fake_install_registry_skill_to_store(*, source, skill_name, paths):
        captured["source"] = source
        captured["skill_name"] = skill_name
        captured["paths"] = paths
        return RegistrySkillInstallResult(
            installed_skills=(
                RegistryInstalledSkill(
                    name="minimax-pdf",
                    relative_path=PurePosixPath("minimax-pdf"),
                    target_dir=Path("/store/dev/minimax-pdf"),
                ),
            ),
        )

    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.install_registry_skill_to_store",
        fake_install_registry_skill_to_store,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev"),
        tool_call_id="tc-embedded-json",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source=':{ "source": "https://github.com/MiniMax-AI/skills.git" }',
    )

    assert captured["source"] == "https://github.com/MiniMax-AI/skills.git"
    assert captured["skill_name"] is None
    assert "minimax-pdf" in result


def test_install_skill_from_registry_uses_embedded_payload_skill_name_for_duplicate_check(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.find_archived_skills_by_name",
        lambda name, agent_status: [
            SimpleNamespace(category="store/prod", skill_path="contract-review", skill_dir=Path("/tmp/contract-review"))
        ]
        if name == "contract-review"
        else [],
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev", command_name="create-agent"),
        tool_call_id="tc-embedded-json-duplicate",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source=':{ "source": "https://github.com/MiniMax-AI/skills.git", "skill_name": "contract-review" }',
    )

    assert "already exists" in result
    assert "store/prod/contract-review" in result


def test_install_skill_from_registry_rejects_duplicate_archive_skill_during_create_agent(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.find_archived_skills_by_name",
        lambda name, agent_status: [
            SimpleNamespace(category="store/prod", skill_path="contract-review", skill_dir=Path("/tmp/contract-review"))
        ],
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_status="dev", command_name="create-agent"),
        tool_call_id="tc-4",
    )

    result = install_skill_from_registry.func(
        runtime=runtime,
        source="claude-office-skills/skills@contract-review",
    )

    assert "already exists" in result
    assert "/mnt/skills/store/prod/contract-review/SKILL.md" in result
    assert "setup_agent(..., skills=[{source_path: \"store/prod/contract-review\"}])" in result
