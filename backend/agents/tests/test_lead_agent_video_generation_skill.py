from pathlib import Path

from src.config.agent_materialization import validate_skill_refs_for_status
from src.config.agents_config import load_agent_config
from src.config.paths import Paths


def _repo_paths() -> Paths:
    repo_root = Path(__file__).resolve().parents[3]
    base_dir = repo_root / ".openagents"
    return Paths(base_dir=base_dir, skills_dir=base_dir)


def test_lead_agent_video_generation_skill_resolves_from_system_archive_and_stays_synced():
    paths = _repo_paths()
    archived_script = paths.system_skill_dir("video-generation") / "scripts" / "generate.py"
    archived_skill_doc = paths.system_skill_dir("video-generation") / "SKILL.md"

    for status in ("dev", "prod"):
        config = load_agent_config("lead_agent", status, paths=paths)
        assert config is not None

        video_skill_ref = next((ref for ref in config.skill_refs if ref.name == "video-generation"), None)
        assert video_skill_ref is not None
        assert video_skill_ref.source_path == "system/skills/video-generation"
        assert video_skill_ref.materialized_path == "skills/video-generation"

        validate_skill_refs_for_status(
            [video_skill_ref],
            target_status=status,
            paths=paths,
        )

        agent_skill_dir = paths.system_agent_skills_dir("lead_agent", status) / "video-generation"
        agent_script = agent_skill_dir / "scripts" / "generate.py"
        agent_skill_doc = agent_skill_dir / "SKILL.md"

        assert agent_script.read_text(encoding="utf-8") == archived_script.read_text(encoding="utf-8")
        assert agent_skill_doc.read_text(encoding="utf-8") == archived_skill_doc.read_text(encoding="utf-8")
        assert 'DEFAULT_MODEL = "doubao-seedance-1-5-pro-251215"' in agent_script.read_text(encoding="utf-8")
