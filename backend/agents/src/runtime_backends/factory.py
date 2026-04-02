from __future__ import annotations

from typing import Literal

from deepagents.backends.protocol import BackendProtocol

from src.config.paths import Paths

from .local import build_local_workspace_backend, resolve_skills_mount
from .operation_logging import wrap_runtime_backend_with_logging
from .remote import REMOTE_EXECUTION_BACKEND, build_remote_workspace_backend
from .sandbox import build_sandbox_workspace_backend, resolve_default_execution_backend

RuntimeBackendKind = Literal["local", "sandbox", "remote"]


def resolve_runtime_backend_kind(requested_backend: str | None = None) -> RuntimeBackendKind:
    normalized = str(requested_backend or "").strip().lower()
    if normalized:
        if normalized != REMOTE_EXECUTION_BACKEND:
            raise ValueError(
                f"Unsupported execution backend '{requested_backend}'. Only 'remote' is selectable per request."
            )
        return REMOTE_EXECUTION_BACKEND
    return resolve_default_execution_backend()


def build_runtime_workspace_backend(
    *,
    user_data_dir: str,
    thread_id: str,
    paths: Paths,
    requested_backend: str | None = None,
    remote_session_id: str | None = None,
) -> BackendProtocol:
    backend_kind = resolve_runtime_backend_kind(requested_backend)
    skills_mount = resolve_skills_mount(paths)

    if backend_kind == REMOTE_EXECUTION_BACKEND:
        if not remote_session_id:
            raise ValueError("Remote execution requires `remote_session_id`.")
        backend = build_remote_workspace_backend(session_id=remote_session_id, paths=paths)
    elif backend_kind == "sandbox":
        backend = build_sandbox_workspace_backend(
            thread_id,
            user_data_dir=user_data_dir,
            skills_mount=skills_mount,
        )
    else:
        backend = build_local_workspace_backend(
            user_data_dir,
            skills_mount=skills_mount,
        )

    return wrap_runtime_backend_with_logging(
        backend,
        backend_kind=backend_kind,
        thread_id=thread_id,
    )
