from __future__ import annotations

from types import SimpleNamespace

from src.agents.lead_agent.agent import LeadAgentRuntimeContext
from src.config.paths import Paths
from src.tools.builtins.authoring_persistence import (
    resolve_default_agent_source_dir,
    resolve_default_skill_source_dir,
)


def test_resolve_default_agent_source_dir_uses_thread_paths_without_state(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(runtime_thread_id="thread-1", user_id="user-1"),
        state={},
    )

    resolved = resolve_default_agent_source_dir(
        runtime=runtime,
        agent_name="demo-agent",
        paths=paths,
    )

    assert resolved == paths.sandbox_authoring_agents_dir("thread-1", user_id="user-1") / "dev" / "demo-agent"


def test_resolve_default_agent_source_dir_prefers_status_scoped_authoring_draft(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(runtime_thread_id="thread-1", user_id="user-1"),
        state={},
    )
    authoring_draft = paths.sandbox_authoring_agents_dir("thread-1", user_id="user-1") / "dev" / "demo-agent"
    runtime_copy = paths.sandbox_agents_dir("thread-1", user_id="user-1") / "dev" / "demo-agent"
    authoring_draft.mkdir(parents=True)
    runtime_copy.mkdir(parents=True)

    resolved = resolve_default_agent_source_dir(
        runtime=runtime,
        agent_name="demo-agent",
        paths=paths,
    )

    assert resolved == authoring_draft


def test_resolve_default_skill_source_dir_uses_thread_paths_without_state(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(runtime_thread_id="thread-2", user_id="user-1"),
        state={},
    )

    resolved = resolve_default_skill_source_dir(
        runtime=runtime,
        skill_name="demo-skill",
        paths=paths,
    )

    assert resolved == paths.sandbox_authoring_skills_dir("thread-2", user_id="user-1") / "demo-skill"
