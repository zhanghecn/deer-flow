from pathlib import Path

import pytest

from src.config.app_config import AppConfig, reset_app_config
from src.config.extensions_config import ExtensionsConfig
from src.config.paths import get_paths, reset_paths


@pytest.fixture(autouse=True)
def _reset_config_singletons():
    reset_app_config()
    reset_paths()
    yield
    reset_app_config()
    reset_paths()


def test_app_config_resolve_path_finds_project_root_from_working_directory(monkeypatch, tmp_path: Path):
    project_root = tmp_path / "repo"
    working_dir = project_root / "backend" / "agents"
    working_dir.mkdir(parents=True)

    project_config = project_root / "config.yaml"
    project_config.write_text(
        "models: []\nsandbox:\n  use: src.sandbox.local:LocalSandboxProvider\n",
        encoding="utf-8",
    )

    monkeypatch.chdir(working_dir)

    resolved = AppConfig.resolve_config_path()
    assert resolved == project_config


def test_extensions_config_resolve_path_finds_project_root_from_working_directory(monkeypatch, tmp_path: Path):
    project_root = tmp_path / "repo"
    working_dir = project_root / "backend" / "agents"
    working_dir.mkdir(parents=True)

    project_extensions = project_root / "extensions_config.json"
    project_extensions.write_text('{"mcpServers": {}, "skills": {}}', encoding="utf-8")

    monkeypatch.chdir(working_dir)

    resolved = ExtensionsConfig.resolve_config_path()
    assert resolved == project_extensions


def test_get_paths_resolves_storage_and_skills_relative_to_config_file(monkeypatch, tmp_path: Path):
    project_root = tmp_path / "repo"
    working_dir = project_root / "backend" / "agents"
    working_dir.mkdir(parents=True)

    config_path = project_root / "config.yaml"
    config_path.write_text(
        "\n".join(
            [
                "models: []",
                "storage:",
                "  base_dir: .openagents",
                "sandbox:",
                "  use: src.sandbox.local:LocalSandboxProvider",
                "skills:",
                "  path: skills",
                "  container_path: /mnt/skills",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.chdir(working_dir)
    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("OPENAGENTS_HOME", raising=False)

    paths = get_paths()

    assert paths.base_dir == project_root / ".openagents"
    assert paths.skills_dir == project_root / "skills"


def test_get_paths_requires_storage_base_dir(monkeypatch, tmp_path: Path):
    project_root = tmp_path / "repo"
    config_path = project_root / "config.yaml"
    project_root.mkdir(parents=True)
    config_path.write_text(
        "\n".join(
            [
                "models: []",
                "sandbox:",
                "  use: src.sandbox.local:LocalSandboxProvider",
                "skills:",
                "  path: skills",
                "  container_path: /mnt/skills",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))

    with pytest.raises(RuntimeError, match="storage.base_dir"):
        get_paths()


def test_get_paths_rebases_default_storage_and_skills_to_openagents_home(monkeypatch, tmp_path: Path):
    project_root = tmp_path / "repo"
    config_path = project_root / "config.yaml"
    runtime_home = tmp_path / "runtime-home"
    project_root.mkdir(parents=True)
    config_path.write_text(
        "\n".join(
            [
                "models: []",
                "storage:",
                "  base_dir: .openagents",
                "sandbox:",
                "  use: src.sandbox.local:LocalSandboxProvider",
                "skills:",
                "  path: .openagents/skills",
                "  container_path: /mnt/skills",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("OPENAGENTS_HOME", str(runtime_home))

    paths = get_paths()

    assert paths.base_dir == runtime_home.resolve()
    assert paths.skills_dir == (runtime_home / "skills").resolve()


def test_get_paths_keeps_explicit_non_default_storage_and_skills(monkeypatch, tmp_path: Path):
    project_root = tmp_path / "repo"
    config_path = project_root / "config.yaml"
    explicit_storage = project_root / "runtime-data"
    explicit_skills = project_root / "custom-skills"
    project_root.mkdir(parents=True)
    config_path.write_text(
        "\n".join(
            [
                "models: []",
                "storage:",
                f"  base_dir: {explicit_storage.name}",
                "sandbox:",
                "  use: src.sandbox.local:LocalSandboxProvider",
                "skills:",
                f"  path: {explicit_skills.name}",
                "  container_path: /mnt/skills",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("OPENAGENTS_HOME", str(tmp_path / "other-home"))

    paths = get_paths()

    assert paths.base_dir == explicit_storage.resolve()
    assert paths.skills_dir == explicit_skills.resolve()
