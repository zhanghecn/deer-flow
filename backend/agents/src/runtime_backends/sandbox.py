from __future__ import annotations

import logging
import os
from functools import lru_cache

from deepagents.backends import CompositeBackend
import yaml
from deepagents.backends.protocol import BackendProtocol

from src.config.app_config import AppConfig
from src.reflection.resolvers import resolve_class
from src.sandbox.sandbox_provider import SandboxProvider

from .internal_routes import build_internal_runtime_routes
from .read_only_filesystem import ReadOnlyFilesystemBackend

logger = logging.getLogger(__name__)

LOCAL_SANDBOX_PROVIDER = "src.sandbox.local:LocalSandboxProvider"


def resolve_config_sandbox_provider() -> str | None:
    config_path = AppConfig.resolve_config_path()
    if config_path is None or not config_path.exists():
        return None

    with open(config_path, encoding="utf-8") as file:
        config_data = yaml.safe_load(file) or {}

    sandbox_config = config_data.get("sandbox")
    if not isinstance(sandbox_config, dict):
        return None

    raw_provider = sandbox_config.get("use")
    if not isinstance(raw_provider, str):
        return None

    provider = raw_provider.strip()
    if not provider:
        return None

    if provider.startswith("$"):
        resolved_env = str(os.getenv(provider[1:], "")).strip()
        return resolved_env or None

    return provider


def resolve_sandbox_provider() -> str:
    env_provider = str(os.getenv("OPENAGENTS_SANDBOX_PROVIDER", "")).strip()
    if env_provider:
        return env_provider

    try:
        return resolve_config_sandbox_provider() or LOCAL_SANDBOX_PROVIDER
    except Exception as exc:
        logger.warning(
            "Failed to resolve sandbox provider from config. Falling back to local execution backend. Error: %s",
            exc,
        )
        return LOCAL_SANDBOX_PROVIDER


def resolve_default_execution_backend() -> str:
    return "local" if resolve_sandbox_provider() == LOCAL_SANDBOX_PROVIDER else "sandbox"


@lru_cache(maxsize=4)
def get_sandbox_provider(provider_path: str) -> SandboxProvider:
    provider_cls = resolve_class(provider_path, base_class=SandboxProvider)
    return provider_cls()


def build_sandbox_workspace_backend(
    thread_id: str,
    *,
    user_id: str | None = None,
    user_data_dir: str | None = None,
    shared_tmp_dir: str | None = None,
    skills_mount: tuple[str, str] | None = None,
) -> BackendProtocol:
    provider_path = resolve_sandbox_provider()
    provider = get_sandbox_provider(provider_path)
    # Sandbox lifecycle state is stored beside the user-scoped thread
    # directory, so the control plane must receive the same owner identity as
    # the file backend even though tools still see only `/mnt/user-data/...`.
    sandbox_id = provider.acquire(thread_id, user_id=user_id)
    sandbox = provider.get(sandbox_id)
    if sandbox is None:
        raise RuntimeError(
            f"Sandbox provider '{provider_path}' returned sandbox id '{sandbox_id}' but no sandbox instance."
        )
    if not user_data_dir and skills_mount is None:
        return sandbox

    routes = (
        build_internal_runtime_routes(
            user_data_dir,
            shared_tmp_dir=shared_tmp_dir,
        )
        if user_data_dir
        else {}
    )
    if skills_mount is not None:
        skills_dir, route_prefix = skills_mount
        # Keep archived store skill reads on a deterministic server-side
        # read-only backend in sandbox mode too. Shell commands still see the
        # mounted `/mnt/skills/...` path inside the sandbox, but normal file
        # tools should not depend on sandbox mount timing or lifecycle.
        routes[route_prefix] = ReadOnlyFilesystemBackend(
            root_dir=skills_dir,
            virtual_mode=True,
        )

    return CompositeBackend(default=sandbox, routes=routes)
