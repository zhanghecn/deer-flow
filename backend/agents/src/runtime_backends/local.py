from __future__ import annotations

import logging
from pathlib import Path

from deepagents.backends import CompositeBackend, FilesystemBackend, LocalShellBackend
from deepagents.backends.protocol import BackendProtocol

from src.config.app_config import get_app_config
from src.config.paths import Paths

from .internal_routes import build_internal_runtime_routes
from .read_only_filesystem import ReadOnlyFilesystemBackend

logger = logging.getLogger(__name__)


def normalize_route_prefix(path: str) -> str:
    normalized = str(path).strip()
    if not normalized.startswith("/"):
        raise ValueError(f"Backend route must be absolute, got {path!r}")
    return normalized.rstrip("/") + "/"


def resolve_shared_skills_mount(paths: Paths) -> tuple[str, str] | None:
    try:
        shared_skills_dir = paths.skills_dir
    except RuntimeError:
        return None

    if not shared_skills_dir.exists():
        return None

    container_path = str(get_app_config().skills.container_path or "").strip()
    if not container_path:
        return None

    try:
        return str(shared_skills_dir), normalize_route_prefix(container_path)
    except ValueError as exc:
        logger.warning("Ignoring invalid shared skills container path %r: %s", container_path, exc)
        return None


def build_runtime_execute_aliases(user_data_dir: str) -> dict[str, str]:
    """Return execute-tool path aliases for the thread runtime tree.

    Filesystem tools already treat absolute paths as rooted under the per-thread
    runtime. Shell execution happens on the host, so shorthand runtime paths such
    as `/agents/...` must be rewritten explicitly to the thread's host directory.
    """

    root = Path(user_data_dir).resolve()
    return {
        "/agents": str(root / "agents"),
        "/authoring": str(root / "authoring"),
    }


def build_local_workspace_backend(
    user_data_dir: str,
    *,
    shared_skills_mount: tuple[str, str] | None = None,
) -> BackendProtocol:
    execute_path_mappings = build_runtime_execute_aliases(user_data_dir)
    routes = build_internal_runtime_routes(user_data_dir)

    if shared_skills_mount is not None:
        shared_skills_dir, route_prefix = shared_skills_mount
        execute_path_mappings[route_prefix.rstrip("/")] = shared_skills_dir
        # The mounted shared skills archive is a discovery/read surface only. The
        # runtime must never mutate the canonical archive through filesystem tools.
        routes[route_prefix] = ReadOnlyFilesystemBackend(
            root_dir=shared_skills_dir,
            virtual_mode=True,
        )

    workspace_backend = LocalShellBackend(
        root_dir=user_data_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=600,
        execute_path_mappings=execute_path_mappings,
    )

    return CompositeBackend(default=workspace_backend, routes=routes)
