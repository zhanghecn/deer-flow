import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.gateway.routers.skills import router


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def _create_skill_archive(tmp_path: Path, skill_name: str) -> Path:
    skill_dir = tmp_path / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {skill_name}\ndescription: Test skill\nlicense: MIT\n---\n\n# {skill_name}\n",
        encoding="utf-8",
    )

    archive_path = tmp_path / f"{skill_name}.skill"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.write(skill_dir / "SKILL.md", f"{skill_name}/SKILL.md")
    return archive_path


def test_install_skill_writes_to_custom_skills(tmp_path: Path):
    archive_path = _create_skill_archive(tmp_path, "contract-review")
    openagents_root = tmp_path / ".openagents"
    paths = Paths(base_dir=openagents_root, skills_dir=openagents_root / "skills")

    with (
        patch("src.gateway.routers.skills.resolve_thread_virtual_path", return_value=archive_path),
        patch("src.gateway.routers.skills.get_paths", return_value=paths),
    ):
        with TestClient(_make_test_app()) as client:
            response = client.post(
                "/api/skills/install",
                json={
                    "thread_id": "thread-1",
                    "path": "/mnt/user-data/outputs/contract-review.skill",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["skill_name"] == "contract-review"
    assert (paths.custom_skills_dir / "contract-review" / "SKILL.md").exists()
