from __future__ import annotations

import base64
import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock

from deepagents.backends.protocol import FileDownloadResponse

from src.agents.lead_agent.agent import LeadAgentRuntimeContext
from src.config.paths import Paths

view_image_tool_module = importlib.import_module("src.tools.builtins.view_image_tool")
view_image_tool = view_image_tool_module.view_image_tool


def test_view_image_tool_downloads_image_via_runtime_backend(monkeypatch, tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    backend = MagicMock()
    backend.download_files.return_value = [
        FileDownloadResponse(
            path="/mnt/user-data/outputs/demo.png",
            content=b"image-bytes",
            error=None,
        )
    ]

    monkeypatch.setattr(view_image_tool_module, "get_paths", lambda: paths)
    monkeypatch.setattr(
        view_image_tool_module,
        "build_runtime_workspace_backend",
        lambda **kwargs: backend,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            runtime_thread_id="thread-1",
            execution_backend="remote",
            remote_session_id="session-1",
        ),
        state={},
    )

    command = view_image_tool.func(
        runtime=runtime,
        image_path="/mnt/user-data/outputs/demo.png",
        tool_call_id="tc-1",
    )

    backend.download_files.assert_called_once_with(["/mnt/user-data/outputs/demo.png"])
    assert command.update["viewed_images"]["/mnt/user-data/outputs/demo.png"]["mime_type"] == "image/png"
    assert command.update["viewed_images"]["/mnt/user-data/outputs/demo.png"]["base64"] == base64.b64encode(
        b"image-bytes"
    ).decode("utf-8")
    assert command.update["messages"][0].content == "Successfully read image"


def test_view_image_tool_returns_structured_error_for_missing_file(monkeypatch, tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    backend = MagicMock()
    backend.download_files.return_value = [
        FileDownloadResponse(
            path="/mnt/user-data/outputs/missing.png",
            content=None,
            error="file_not_found",
        )
    ]

    monkeypatch.setattr(view_image_tool_module, "get_paths", lambda: paths)
    monkeypatch.setattr(
        view_image_tool_module,
        "build_runtime_workspace_backend",
        lambda **kwargs: backend,
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(runtime_thread_id="thread-1"),
        state={},
    )

    command = view_image_tool.func(
        runtime=runtime,
        image_path="/mnt/user-data/outputs/missing.png",
        tool_call_id="tc-2",
    )

    assert command.update["messages"][0].content == "Error: Image file not found: /mnt/user-data/outputs/missing.png"
