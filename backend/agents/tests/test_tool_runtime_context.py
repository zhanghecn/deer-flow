from pathlib import Path, PurePosixPath
from types import SimpleNamespace

import yaml

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
from src.tools.builtins.setup_agent_tool import setup_agent


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
            agent_dir=lambda name, status: Path(f"/tmp/{status}/{name}"),
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            agent_status="dev",
            model_name="glm-5",
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

    archive_agent_dir = paths.agent_dir("landing-copy-agent-0318", "dev")
    assert (archive_agent_dir / "AGENTS.md").read_text(encoding="utf-8") == new_agents_md
    assert (runtime_agent_dir / "AGENTS.md").read_text(encoding="utf-8") == new_agents_md
    assert (runtime_skill_dir / "SKILL.md").read_text(encoding="utf-8") == new_skill_content
    assert command.update["created_agent_name"] == "landing-copy-agent-0318"


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
    archive_agent_dir = paths.agent_dir("landing-copy-agent-0318", "dev")
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
            agent_dir=lambda name, status: Path(f"/tmp/{status}/{name}"),
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
