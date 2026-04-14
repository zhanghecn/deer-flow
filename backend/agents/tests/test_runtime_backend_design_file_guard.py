from __future__ import annotations

import json

from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
    SandboxBackendProtocol,
    WriteResult,
)

from src.runtime_backends.design_file_guard import wrap_runtime_backend_with_design_file_guard


class _MemorySandboxBackend(SandboxBackendProtocol):
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    @property
    def id(self) -> str:
        return "memory-sandbox"

    def ls_info(self, path: str):
        return []

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        content = self.files.get(file_path)
        return "" if content is None else content.decode("utf-8")

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None):
        return []

    def glob_info(self, pattern: str, path: str = "/"):
        return []

    def write(self, file_path: str, content: str) -> WriteResult:
        if file_path in self.files:
            return WriteResult(error=f"Error: File '{file_path}' already exists")
        self.files[file_path] = content.encode("utf-8")
        return WriteResult(path=file_path, files_update=None)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        content = self.files.get(file_path)
        if content is None:
            return EditResult(error=f"Error: File '{file_path}' not found")
        existing_text = content.decode("utf-8")
        occurrences = existing_text.count(old_string)
        if occurrences == 0:
            return EditResult(error=f"Error: String not found in file: '{old_string}'")
        if occurrences > 1 and not replace_all:
            return EditResult(
                error=(
                    f"Error: String '{old_string}' appears multiple times. "
                    "Use replace_all=true to replace all occurrences."
                )
            )
        next_text = (
            existing_text.replace(old_string, new_string)
            if replace_all
            else existing_text.replace(old_string, new_string, 1)
        )
        self.files[file_path] = next_text.encode("utf-8")
        return EditResult(path=file_path, files_update=None, occurrences=occurrences)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        for path, content in files:
            self.files[path] = content
        return [FileUploadResponse(path=path, error=None) for path, _ in files]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            content = self.files.get(path)
            if content is None:
                responses.append(FileDownloadResponse(path=path, content=None, error="file_not_found"))
                continue
            responses.append(FileDownloadResponse(path=path, content=content, error=None))
        return responses

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        return ExecuteResponse(output=command, exit_code=0, truncated=False)


def test_design_file_guard_rejects_invalid_openpencil_write():
    backend = _MemorySandboxBackend()
    guarded = wrap_runtime_backend_with_design_file_guard(backend)

    result = guarded.write(
        "/mnt/user-data/outputs/designs/canvas.op",
        '{"version":"1.0.0","children":[{"id":"broken"}]',
    )

    assert result.error is not None
    assert "OpenPencil design documents must be valid JSON" in result.error
    assert "/mnt/user-data/outputs/designs/canvas.op" not in backend.files


def test_design_file_guard_normalizes_valid_openpencil_write():
    backend = _MemorySandboxBackend()
    guarded = wrap_runtime_backend_with_design_file_guard(backend)

    result = guarded.write(
        "/mnt/user-data/outputs/designs/canvas.op",
        '{"version":"1.0.0","children":[{"id":"hero","type":"frame"}]}',
    )

    assert result.error is None
    written = backend.files["/mnt/user-data/outputs/designs/canvas.op"].decode("utf-8")
    assert written.endswith("\n")
    assert "\n  \"version\": \"1.0.0\"" in written
    assert json.loads(written) == {
        "version": "1.0.0",
        "children": [{"id": "hero", "type": "frame"}],
    }


def test_design_file_guard_rejects_invalid_openpencil_edit_without_mutating_file():
    backend = _MemorySandboxBackend()
    existing_document = '{\n  "version": "1.0.0",\n  "children": []\n}\n'
    backend.files["/mnt/user-data/outputs/designs/canvas.op"] = existing_document.encode("utf-8")
    guarded = wrap_runtime_backend_with_design_file_guard(backend)

    result = guarded.edit(
        "/mnt/user-data/outputs/designs/canvas.op",
        existing_document,
        '{"version":"1.0.0","children":[{"id":"broken"}]',
    )

    assert result.error is not None
    assert "OpenPencil design documents must be valid JSON" in result.error
    assert (
        backend.files["/mnt/user-data/outputs/designs/canvas.op"].decode("utf-8")
        == existing_document
    )


def test_design_file_guard_rewrites_full_document_after_valid_edit():
    backend = _MemorySandboxBackend()
    existing_document = (
        '{\n'
        '  "version": "1.0.0",\n'
        '  "children": [\n'
        '    {\n'
        '      "id": "page-root",\n'
        '      "type": "frame",\n'
        '      "name": "Login Page"\n'
        '    }\n'
        '  ]\n'
        '}\n'
    )
    backend.files["/mnt/user-data/outputs/designs/canvas.op"] = existing_document.encode("utf-8")
    guarded = wrap_runtime_backend_with_design_file_guard(backend)

    result = guarded.edit(
        "/mnt/user-data/outputs/designs/canvas.op",
        '      "name": "Login Page"',
        '      "name": "REALTIME_AGENT_PROBE_1"',
    )

    assert result.error is None
    written = backend.files["/mnt/user-data/outputs/designs/canvas.op"].decode("utf-8")
    parsed = json.loads(written)
    assert parsed["children"][0]["name"] == "REALTIME_AGENT_PROBE_1"
    assert written.count("REALTIME_AGENT_PROBE_1") == 1
    assert written.strip().endswith("}")


def test_design_file_guard_normalizes_common_openpencil_shorthand():
    backend = _MemorySandboxBackend()
    guarded = wrap_runtime_backend_with_design_file_guard(backend)

    result = guarded.write(
        "/mnt/user-data/outputs/designs/canvas.op",
        json.dumps(
            {
                "version": "1.0.0",
                "children": [
                    {
                        "id": "page-root",
                        "type": "frame",
                        "justifyContent": "space-between",
                        "padding": {"left": 16, "right": 16},
                        "children": [
                            {
                                "id": "logo",
                                "type": "ellipse",
                                "width": 64,
                                "height": 64,
                                "fill": {"color": "#4F46E5"},
                                "stroke": {"color": "#E5E7EB", "width": 1},
                                "effects": [{"type": "shadow", "blur": 12, "color": "#00000010"}],
                            }
                        ],
                    }
                ],
            }
        ),
    )

    assert result.error is None

    written = json.loads(
        backend.files["/mnt/user-data/outputs/designs/canvas.op"].decode("utf-8")
    )
    root = written["children"][0]
    logo = root["children"][0]

    assert root["justifyContent"] == "space_between"
    assert root["padding"] == [0, 16]
    assert logo["fill"] == [{"type": "solid", "color": "#4F46E5"}]
    assert logo["stroke"] == {
        "thickness": 1,
        "fill": [{"type": "solid", "color": "#E5E7EB"}],
    }
    assert logo["effects"] == [
        {
            "type": "shadow",
            "blur": 12,
            "color": "#00000010",
            "offsetX": 0,
            "offsetY": 0,
            "spread": 0,
        }
    ]
