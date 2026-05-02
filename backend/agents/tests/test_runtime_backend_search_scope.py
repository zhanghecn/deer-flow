from __future__ import annotations

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import (
    BackendProtocol,
    EditResult,
    FileDownloadResponse,
    FileUploadResponse,
    WriteResult,
)

from src.runtime_backends.search_scope import scope_composite_root_search


class _RecordingBackend(BackendProtocol):
    def __init__(self, name: str) -> None:
        self.name = name
        self.grep_calls: list[tuple[str | None, str | None]] = []
        self.glob_calls: list[tuple[str, str]] = []

    def ls_info(self, path: str):
        return []

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return ""

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None):
        self.grep_calls.append((path, glob))
        return [{"path": "/match.txt", "line": 1, "text": pattern}]

    def glob_info(self, pattern: str, path: str = "/"):
        self.glob_calls.append((pattern, path))
        return [{"path": "/match.txt", "is_dir": False}]

    def write(self, file_path: str, content: str) -> WriteResult:
        return WriteResult(path=file_path, files_update=None)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        return EditResult(path=file_path, files_update=None, occurrences=1)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return [FileUploadResponse(path=path, error=None) for path, _ in files]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return [FileDownloadResponse(path=path, content=b"", error=None) for path in paths]


def test_root_grep_does_not_fan_out_to_routed_backends():
    default = _RecordingBackend("default")
    skills = _RecordingBackend("skills")
    backend = scope_composite_root_search(
        CompositeBackend(default=default, routes={"/mnt/skills/": skills})
    )

    result = backend.grep_raw("needle", path="/")

    assert [match["path"] for match in result] == ["/match.txt"]
    assert default.grep_calls == [("/", None)]
    assert skills.grep_calls == []


def test_default_grep_does_not_fan_out_to_routed_backends():
    default = _RecordingBackend("default")
    skills = _RecordingBackend("skills")
    backend = scope_composite_root_search(
        CompositeBackend(default=default, routes={"/mnt/skills/": skills})
    )

    backend.grep_raw("needle")

    assert default.grep_calls == [(None, None)]
    assert skills.grep_calls == []


def test_explicit_routed_grep_still_uses_routed_backend():
    default = _RecordingBackend("default")
    skills = _RecordingBackend("skills")
    backend = scope_composite_root_search(
        CompositeBackend(default=default, routes={"/mnt/skills/": skills})
    )

    result = backend.grep_raw("needle", path="/mnt/skills/")

    assert [match["path"] for match in result] == ["/mnt/skills/match.txt"]
    assert default.grep_calls == []
    assert skills.grep_calls == [("/", None)]


def test_root_glob_does_not_fan_out_to_routed_backends():
    default = _RecordingBackend("default")
    skills = _RecordingBackend("skills")
    backend = scope_composite_root_search(
        CompositeBackend(default=default, routes={"/mnt/skills/": skills})
    )

    result = backend.glob_info("**/*.md", path="/")

    assert [item["path"] for item in result] == ["/match.txt"]
    assert default.glob_calls == [("**/*.md", "/")]
    assert skills.glob_calls == []


def test_explicit_routed_glob_still_uses_routed_backend():
    default = _RecordingBackend("default")
    skills = _RecordingBackend("skills")
    backend = scope_composite_root_search(
        CompositeBackend(default=default, routes={"/mnt/skills/": skills})
    )

    result = backend.glob_info("**/*.md", path="/mnt/skills/")

    assert [item["path"] for item in result] == ["/mnt/skills/match.txt"]
    assert default.glob_calls == []
    assert skills.glob_calls == [("**/*.md", "/")]
