from pathlib import Path

from src.config.app_config import AppConfig
from src.config.extensions_config import ExtensionsConfig


def test_app_config_resolve_path_finds_project_root(monkeypatch, tmp_path: Path):
    agents_root = tmp_path / "backend" / "agents"
    agents_root.mkdir(parents=True)
    project_config = tmp_path / "config.yaml"
    project_config.write_text("models: []\nsandbox:\n  use: src.sandbox.local:LocalSandboxProvider\n", encoding="utf-8")

    monkeypatch.chdir(agents_root)
    monkeypatch.setattr("src.config.app_config.AGENTS_ROOT", agents_root)

    resolved = AppConfig.resolve_config_path()
    assert resolved == project_config


def test_extensions_config_resolve_path_finds_project_root(monkeypatch, tmp_path: Path):
    agents_root = tmp_path / "backend" / "agents"
    agents_root.mkdir(parents=True)
    project_extensions = tmp_path / "extensions_config.json"
    project_extensions.write_text('{"mcpServers": {}, "skills": {}}', encoding="utf-8")

    monkeypatch.chdir(agents_root)
    monkeypatch.setattr("src.config.extensions_config.AGENTS_ROOT", agents_root)

    resolved = ExtensionsConfig.resolve_config_path()
    assert resolved == project_extensions
