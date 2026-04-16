from pathlib import Path

import pytest

from src.config.agent_materialization import (
    materialize_agent_definition,
    materialize_agent_skills,
    resolve_skill_refs,
)
from src.config.agents_config import AgentSkillRef
from src.config.agents_config import load_agent_config, load_agent_subagents
from src.config.paths import Paths


def _write_skill(base_dir: Path, scope: str, relative_path: str, name: str) -> None:
    skill_dir = base_dir / "skills" / Path(scope) / Path(relative_path)
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n\n# {name}\n",
        encoding="utf-8",
    )


def test_agent_skill_ref_derives_agent_materialized_path_from_store_prod_source():
    ref = AgentSkillRef(name="bootstrap", source_path="store/prod/bootstrap")

    assert ref.category == "store/prod"
    assert ref.materialized_path == "skills/bootstrap"


def test_agent_skill_ref_derives_agent_materialized_path_from_store_prod_source():
    ref = AgentSkillRef(name="contract-review", source_path="store/prod/contracts/review")

    assert ref.category == "store/prod"
    assert ref.materialized_path == "skills/contracts/review"


def test_resolve_skill_refs_prefers_store_prod_when_dev_agent_only_has_prod_match(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/prod", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    skills = resolve_skill_refs(["bootstrap"], paths=paths)

    assert len(skills) == 1
    assert skills[0].category == "store/prod"


def test_resolve_skill_refs_rejects_duplicate_dev_and_prod_names_for_dev_agents(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/dev", "bootstrap", "bootstrap")
    _write_skill(base_dir, "store/prod", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    with pytest.raises(ValueError, match="exists in both store/dev and store/prod"):
        resolve_skill_refs(["bootstrap"], paths=paths)


def test_materialize_agent_skills_copies_nested_store_prod_skill_into_agent_private_tree(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/prod", "contracts/review", "contract-review")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    materialized_root = base_dir / "agents" / "dev" / "reviewer" / "skills"

    refs = materialize_agent_skills(
        skills_dir=materialized_root,
        skill_names=["contract-review"],
        paths=paths,
    )

    assert refs == [
        AgentSkillRef(
            name="contract-review",
            category="store/prod",
            source_path="store/prod/contracts/review",
            materialized_path="skills/contracts/review",
        )
    ]
    assert (materialized_root / "contracts" / "review" / "SKILL.md").exists()


def test_materialize_agent_definition_allows_explicit_prod_source_path_for_dev_agents(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/dev", "bootstrap", "bootstrap")
    _write_skill(base_dir, "store/prod", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    config = materialize_agent_definition(
        name="contract-agent",
        status="dev",
        agents_md="# Contract Agent",
        description="Reviews contracts",
        skill_refs=[{"name": "bootstrap", "source_path": "store/prod/bootstrap"}],
        paths=paths,
    )

    agent_skills_dir = base_dir / "custom" / "agents" / "dev" / "contract-agent" / "skills"
    assert (agent_skills_dir / "bootstrap" / "SKILL.md").exists()
    assert config.skill_refs == [
        AgentSkillRef(
            name="bootstrap",
            category="store/prod",
            source_path="store/prod/bootstrap",
            materialized_path="skills/bootstrap",
        )
    ]


def test_materialize_agent_definition_writes_inline_agent_skills_and_manifest(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/dev", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    config = materialize_agent_definition(
        name="contract-agent",
        status="dev",
        agents_md="# Contract Agent",
        description="Reviews contracts",
        skill_names=["bootstrap"],
        inline_skills=[
            {
                "name": "contract-review",
                "content": "---\nname: contract-review\ndescription: Review contracts\n---\n\n# contract-review\n",
            }
        ],
        paths=paths,
    )

    agent_skills_dir = base_dir / "custom" / "agents" / "dev" / "contract-agent" / "skills"
    assert (agent_skills_dir / "bootstrap" / "SKILL.md").exists()
    assert (agent_skills_dir / "contract-review" / "SKILL.md").read_text(encoding="utf-8").startswith("---\nname: contract-review")
    assert config.skill_refs == [
        AgentSkillRef(
            name="bootstrap",
            category="store/dev",
            source_path="store/dev/bootstrap",
            materialized_path="skills/bootstrap",
        ),
        AgentSkillRef(
            name="contract-review",
            materialized_path="skills/contract-review",
        ),
    ]

    loaded = load_agent_config("contract-agent", "dev", paths=paths)
    assert loaded is not None
    assert loaded.skill_refs == config.skill_refs


def test_materialize_agent_definition_persists_owner_user_id(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    materialize_agent_definition(
        name="owned-agent",
        status="dev",
        agents_md="# Owned Agent",
        owner_user_id="user-123",
        description="Owned by a specific user",
        paths=paths,
    )

    loaded = load_agent_config("owned-agent", "dev", paths=paths)
    assert loaded is not None
    assert loaded.owner_user_id == "user-123"


def test_materialize_agent_definition_writes_subagent_defaults_and_subagents(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    config = materialize_agent_definition(
        name="contract-agent",
        status="dev",
        agents_md="# Contract Agent",
        description="Reviews contracts",
        tool_names=["present_files"],
        subagent_defaults={
            "general_purpose_enabled": False,
            "tool_names": ["present_files"],
        },
        subagents=[
            {
                "name": "reviewer",
                "description": "Review generated drafts",
                "system_prompt": "Review carefully.",
                "tool_names": ["present_files"],
            }
        ],
        paths=paths,
    )

    assert config.tool_names == ["present_files"]
    assert config.subagent_defaults.general_purpose_enabled is False
    assert config.subagent_defaults.tool_names == ["present_files"]

    loaded = load_agent_config("contract-agent", "dev", paths=paths)
    assert loaded is not None
    assert loaded.tool_names == ["present_files"]
    assert loaded.subagent_defaults.general_purpose_enabled is False

    subagents = load_agent_subagents("contract-agent", "dev", paths=paths)
    assert [item.name for item in subagents.subagents] == ["reviewer"]
    assert subagents.subagents[0].tool_names == ["present_files"]


def test_materialize_agent_definition_rejects_store_dev_skills_for_prod_agents(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/dev", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    with pytest.raises(ValueError, match="allowed scopes: system, custom, store/prod"):
        materialize_agent_definition(
            name="contract-agent",
            status="prod",
            agents_md="# Contract Agent",
            description="Reviews contracts",
            skill_names=["bootstrap"],
            paths=paths,
        )


def test_materialize_agent_definition_accepts_canonical_mcp_profile_refs(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    profile_file = paths.custom_mcp_profile_file("customer-docs.json")
    profile_file.parent.mkdir(parents=True, exist_ok=True)
    profile_file.write_text(
        '{\n  "mcpServers": {\n    "customer-docs": {\n      "type": "http",\n      "url": "https://customer.example.com/mcp"\n    }\n  }\n}\n',
        encoding="utf-8",
    )

    config = materialize_agent_definition(
        name="support-agent",
        status="dev",
        agents_md="# Support Agent",
        description="Answers customer questions",
        mcp_servers=["custom/mcp-profiles/customer-docs.json"],
        paths=paths,
    )

    assert config.mcp_servers == ["custom/mcp-profiles/customer-docs.json"]


def test_materialize_agent_definition_rejects_missing_canonical_mcp_profile_refs(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    with pytest.raises(FileNotFoundError, match="MCP profile not found"):
        materialize_agent_definition(
            name="support-agent",
            status="dev",
            agents_md="# Support Agent",
            description="Answers customer questions",
            mcp_servers=["custom/mcp-profiles/missing.json"],
            paths=paths,
        )


def test_materialize_agent_definition_does_not_mutate_existing_archive_when_resolution_fails(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/dev", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    existing_agent_dir = paths.custom_agent_dir("contract-agent", "dev")
    (existing_agent_dir / "skills" / "bootstrap").mkdir(parents=True, exist_ok=True)
    (existing_agent_dir / "AGENTS.md").write_text("# Original Agent", encoding="utf-8")
    (existing_agent_dir / "skills" / "bootstrap" / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n",
        encoding="utf-8",
    )
    (existing_agent_dir / "config.yaml").write_text(
        "name: contract-agent\nstatus: dev\ndescription: original\nagents_md_path: AGENTS.md\nskill_refs:\n  - name: bootstrap\n    source_path: store/dev/bootstrap\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="not found in allowed scopes"):
        materialize_agent_definition(
            name="contract-agent",
            status="dev",
            agents_md="# Broken Agent",
            description="broken",
            skill_names=["missing-skill"],
            paths=paths,
        )

    assert (existing_agent_dir / "AGENTS.md").read_text(encoding="utf-8") == "# Original Agent"
    assert (existing_agent_dir / "skills" / "bootstrap" / "SKILL.md").exists()
    loaded = load_agent_config("contract-agent", "dev", paths=paths)
    assert loaded is not None
    assert loaded.description == "original"


def test_agent_skill_ref_rejects_unsafe_source_path():
    with pytest.raises(ValueError, match="safe relative path"):
        AgentSkillRef(name="bad", source_path="../escape")
