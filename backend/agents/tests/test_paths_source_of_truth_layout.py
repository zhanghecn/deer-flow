from pathlib import Path

from src.config.paths import Paths


def test_paths_expose_system_custom_runtime_roots(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    assert paths.system_dir == base_dir / "system"
    assert paths.custom_dir == base_dir / "custom"
    assert paths.runtime_dir == base_dir / "runtime"


def test_paths_build_agent_directories_per_layer_and_status(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    assert paths.system_agent_dir("Lead_Agent", "prod") == base_dir / "system" / "agents" / "prod" / "lead_agent"
    assert paths.custom_agent_dir("ResearchBot", "dev") == base_dir / "custom" / "agents" / "dev" / "researchbot"
    assert paths.runtime_agent_dir("ResearchBot", "prod") == base_dir / "runtime" / "agents" / "prod" / "researchbot"


def test_paths_build_skill_directories_without_skill_environment_split(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    assert paths.system_skill_dir("bootstrap") == base_dir / "system" / "skills" / "bootstrap"
    assert paths.custom_skill_dir(Path("pptx-generator")) == base_dir / "custom" / "skills" / "pptx-generator"


def test_paths_expose_runtime_data_roots(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    assert paths.runtime_threads_dir == base_dir / "runtime" / "threads"
    assert paths.runtime_users_dir == base_dir / "runtime" / "users"
    assert paths.runtime_knowledge_dir == base_dir / "runtime" / "knowledge"
