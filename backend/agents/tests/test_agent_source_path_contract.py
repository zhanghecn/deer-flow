import pytest

from src.config.agents_config import AgentSkillRef


def test_agent_skill_ref_accepts_canonical_system_source_path():
    ref = AgentSkillRef(name="bootstrap", source_path="system/skills/bootstrap")

    assert ref.category == "system"
    assert ref.materialized_path == "skills/bootstrap"


def test_agent_skill_ref_accepts_canonical_custom_nested_source_path():
    ref = AgentSkillRef(name="minimax-docx", source_path="custom/skills/office/docx")

    assert ref.category == "custom"
    assert ref.materialized_path == "skills/office/docx"


def test_agent_skill_ref_rejects_non_skill_root_source_path():
    with pytest.raises(ValueError, match="must start with one of"):
        AgentSkillRef(name="broken", source_path="custom/tools/broken")
