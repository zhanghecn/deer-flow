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
        context=LeadAgentRuntimeContext(runtime_thread_id="thread-1"),
        state={},
    )

    resolved = resolve_default_agent_source_dir(
        runtime=runtime,
        agent_name="demo-agent",
        paths=paths,
    )

    assert resolved == paths.sandbox_authoring_agents_dir("thread-1") / "demo-agent"


def test_resolve_default_skill_source_dir_uses_thread_paths_without_state(tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(runtime_thread_id="thread-2"),
        state={},
    )

    resolved = resolve_default_skill_source_dir(
        runtime=runtime,
        skill_name="demo-skill",
        paths=paths,
    )

    assert resolved == paths.sandbox_authoring_skills_dir("thread-2") / "demo-skill"
