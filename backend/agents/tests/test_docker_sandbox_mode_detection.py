"""Regression tests for docker sandbox mode detection logic."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "docker.sh"


def _detect_mode(
    *,
    config_content: str | None = None,
    extra_env: dict[str, str] | None = None,
) -> str:
    """Write temp root config and execute detect_sandbox_mode."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_root = Path(tmpdir)
        if config_content is not None:
            (tmp_root / "config.yaml").write_text(config_content)
        (tmp_root / ".env").write_text("DATABASE_URI=postgresql://placeholder\n", encoding="utf-8")

        command = (
            f"source '{SCRIPT_PATH}'"
            f" && PROJECT_ROOT='{tmp_root}'"
            f" && ROOT_ENV_FILE='{tmp_root / '.env'}'"
            " && detect_sandbox_mode"
        )
        env = os.environ.copy()
        env.pop("OPENAGENTS_SANDBOX_PROVIDER", None)
        if extra_env:
            env.update(extra_env)

        output = subprocess.check_output(
            ["bash", "-lc", command],
            text=True,
            env=env,
        ).strip()

        return output


def test_detect_mode_defaults_to_local_when_config_missing():
    """No config file should default to local mode."""
    assert _detect_mode() == "local"


def test_detect_mode_local_provider():
    """Local sandbox provider should map to local mode."""
    config = """
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
""".strip()

    assert _detect_mode(config_content=config) == "local"


def test_detect_mode_aio_without_provisioner_url():
    """AIO sandbox without provisioner_url should map to aio mode."""
    config = """
sandbox:
  use: src.community.aio_sandbox:AioSandboxProvider
""".strip()

    assert _detect_mode(config_content=config) == "aio"


def test_detect_mode_provisioner_with_url():
    """AIO sandbox with provisioner_url should map to provisioner mode."""
    config = """
sandbox:
  use: src.community.aio_sandbox:AioSandboxProvider
  provisioner_url: http://provisioner:8002
""".strip()

    assert _detect_mode(config_content=config) == "provisioner"


def test_detect_mode_ignores_commented_provisioner_url():
    """Commented provisioner_url should not activate provisioner mode."""
    config = """
sandbox:
  use: src.community.aio_sandbox:AioSandboxProvider
  # provisioner_url: http://provisioner:8002
""".strip()

    assert _detect_mode(config_content=config) == "aio"


def test_detect_mode_unknown_provider_falls_back_to_local():
    """Unknown sandbox provider should default to local mode."""
    config = """
sandbox:
  use: custom.module:UnknownProvider
""".strip()

    assert _detect_mode(config_content=config) == "local"


def test_detect_mode_env_provider_without_config():
    """Explicit shell env provider should enable AIO mode without config.yaml duplication."""
    assert (
        _detect_mode(
            extra_env={"OPENAGENTS_SANDBOX_PROVIDER": "src.community.aio_sandbox:AioSandboxProvider"}
        )
        == "aio"
    )


def test_detect_mode_env_provider_overrides_config_provider():
    """Explicit env provider should win over config.yaml provider."""
    config = """
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
""".strip()

    assert (
        _detect_mode(
            config_content=config,
            extra_env={"OPENAGENTS_SANDBOX_PROVIDER": "src.community.aio_sandbox:AioSandboxProvider"},
        )
        == "aio"
    )
