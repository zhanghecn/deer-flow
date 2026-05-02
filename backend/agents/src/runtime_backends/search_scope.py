from __future__ import annotations

from typing import Any

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import BackendProtocol, FileInfo, GrepMatch


def _is_implicit_root_search(path: str | None) -> bool:
    if path is None:
        return True
    return str(path).strip() in {"", "/", "."}


class RootSearchScopedCompositeBackend(CompositeBackend):
    """Composite backend that keeps broad searches inside the thread workspace.

    Deep Agents' default CompositeBackend treats `grep(path="/")` and
    `glob(path="/")` as "search every route". In OpenAgents those routes include
    read-only skill archives and runtime spill directories, so an accidental root
    search can crawl large caches instead of the current conversation workspace.
    Explicit route paths such as `/mnt/skills/...` still use the routed backend.
    """

    def __init__(self, wrapped_backend: CompositeBackend) -> None:
        super().__init__(
            default=wrapped_backend.default,
            routes=wrapped_backend.routes,
        )
        self.__wrapped_backend__ = wrapped_backend

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped_backend__, name)

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        if _is_implicit_root_search(path):
            return self.default.grep_raw(pattern, path=path, glob=glob)
        return self.__wrapped_backend__.grep_raw(pattern, path=path, glob=glob)

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        if _is_implicit_root_search(path):
            return self.default.glob_info(pattern, path=path)
        return self.__wrapped_backend__.glob_info(pattern, path=path)


def scope_composite_root_search(backend: BackendProtocol) -> BackendProtocol:
    """Avoid route fan-out for broad search tools while preserving route access."""

    if isinstance(backend, RootSearchScopedCompositeBackend):
        return backend
    if isinstance(backend, CompositeBackend):
        return RootSearchScopedCompositeBackend(backend)
    return backend


__all__ = [
    "RootSearchScopedCompositeBackend",
    "scope_composite_root_search",
]
