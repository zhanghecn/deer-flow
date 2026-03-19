from pathlib import Path
from types import SimpleNamespace

import yaml

from src.agents.lead_agent.agent import LeadAgentRuntimeContext
from src.config.paths import Paths
from src.tools.builtins.install_skill_from_registry_tool import install_skill_from_registry
from src.tools.builtins.push_agent_prod_tool import push_agent_prod
from src.tools.builtins.runtime_context import runtime_context_value
from src.tools.builtins.save_agent_to_store_tool import save_agent_to_store
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
            agent_dir=lambda name, status: f"/tmp/{status}/{name}",
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            target_agent_name="contract-agent",
            agent_status="dev",
            model_name="glm-5",
        ),
        tool_call_id="tc-1",
    )

    command = setup_agent.func(
        agents_md="# Contract Agent",
        description="Reviews contracts",
        runtime=runtime,
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
    assert calls["skill_names"] == ["bootstrap"]
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
        skills=[{"name": "saas-landing-copywriter"}],
    )

    assert calls["skill_names"] == []
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
    )

    assert calls["skill_names"] == []
    assert calls["inline_skills"] == [
        {
            "name": "saas-landing-copywriter",
            "content": "---\nname: saas-landing-copywriter\ndescription: Preserved archive copy.\n---\n\n# preserved-skill\n",
        }
    ]


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
        skills=[{"name": "saas-landing-copywriter"}],
    )

    message = result.update["messages"][0].content
    assert "full SKILL.md" in message
    assert "agent-owned skill" in message
    assert "saas-landing-copywriter" in message


def test_save_and_push_agent_tools_accept_typed_runtime_context(monkeypatch):
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
        context=LeadAgentRuntimeContext(agent_name="contract-agent"),
        tool_call_id="tc-2",
    )

    save_result = save_agent_to_store.func(runtime=runtime)
    push_result = push_agent_prod.func(runtime=runtime)

    assert "contract-agent" in save_result.update["messages"][0].content
    assert "contract-agent" in push_result.update["messages"][0].content


def test_install_skill_from_registry_tool_returns_success_message(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.install_skill_from_registry_tool.install_registry_skill_to_store",
        lambda source, skill_name, paths: ("copywriting", "/store/dev/copywriting"),
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
