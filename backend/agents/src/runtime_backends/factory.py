from __future__ import annotations

from typing import Literal

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import BackendProtocol

from src.config.paths import Paths

from .knowledge_filesystem import KNOWLEDGE_ROUTE_PREFIX, ThreadKnowledgeFilesystemBackend
from .local import build_local_workspace_backend, resolve_skills_mount
from .operation_logging import wrap_runtime_backend_with_logging
from .remote import REMOTE_EXECUTION_BACKEND, build_remote_workspace_backend
from .sandbox import build_sandbox_workspace_backend, resolve_default_execution_backend
from .search_scope import scope_composite_root_search

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
    user_id: str | None = None,
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
            user_id=user_id,
            user_data_dir=user_data_dir,
            shared_tmp_dir=str(paths.runtime_tmp_dir),
            skills_mount=skills_mount,
        )
    else:
        backend = build_local_workspace_backend(
            user_data_dir,
            shared_tmp_dir=str(paths.runtime_tmp_dir),
            skills_mount=skills_mount,
        )

    backend_with_knowledge = _attach_thread_knowledge_route(
        backend,
        thread_id=thread_id,
        user_id=user_id,
    )
    scoped_backend = scope_composite_root_search(backend_with_knowledge)
    return wrap_runtime_backend_with_logging(
        scoped_backend,
        backend_kind=backend_kind,
        thread_id=thread_id,
    )


def _attach_thread_knowledge_route(
    backend: BackendProtocol,
    *,
    thread_id: str,
    user_id: str | None,
) -> BackendProtocol:
    """Mount attached knowledge as read-only files under `/mnt/user-data`.

    The route is created for every real thread but resolves attached workspaces
    lazily per operation. That keeps backend construction cheap and preserves
    the object-store boundary: agents see files, while storage refs and MinIO
    keys never leak into prompts or tool arguments.
    """

    if not user_id:
        return backend

    knowledge_backend = ThreadKnowledgeFilesystemBackend(
        user_id=user_id,
        thread_id=thread_id,
    )
    if isinstance(backend, CompositeBackend):
        return CompositeBackend(
            default=backend.default,
            routes={
                **backend.routes,
                KNOWLEDGE_ROUTE_PREFIX: knowledge_backend,
            },
        )
    return CompositeBackend(
        default=backend,
        routes={KNOWLEDGE_ROUTE_PREFIX: knowledge_backend},
    )
