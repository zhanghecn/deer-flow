from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / ".openagents/skills/store/prod/video-generation/scripts/generate.py"


class FakeResponse:
    def __init__(self, json_data=None, content: bytes = b"", status_code: int = 200):
        self._json_data = json_data
        self.content = content
        self.status_code = status_code
        self.ok = status_code < 400
        self.text = ""

    def json(self):
        return self._json_data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def load_video_generation_module():
    spec = importlib.util.spec_from_file_location("video_generation_skill_test", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_task_payload_uses_reference_image_for_single_input(tmp_path):
    module = load_video_generation_module()
    reference_image = tmp_path / "reference.png"
    reference_image.write_bytes(b"png-bytes")

    payload = module.build_task_payload("prompt text", [str(reference_image)], "9:16")

    assert payload["model"] == module.DEFAULT_MODEL
    assert payload["ratio"] == "9:16"
    assert payload["content"][0] == {"type": "text", "text": "prompt text"}
    assert payload["content"][1]["role"] == "reference_image"
    assert payload["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_generate_video_requires_ark_api_key(monkeypatch, tmp_path):
    module = load_video_generation_module()
    prompt_file = tmp_path / "prompt.json"
    prompt_file.write_text('{"scene":"city"}', encoding="utf-8")
    output_file = tmp_path / "generated.mp4"
    monkeypatch.delenv("ARK_API_KEY", raising=False)

    with pytest.raises(ValueError, match="ARK_API_KEY is not set"):
        module.generate_video(str(prompt_file), [], str(output_file))


def test_generate_video_polls_until_success_and_downloads_video(monkeypatch, tmp_path):
    module = load_video_generation_module()
    prompt_file = tmp_path / "prompt.json"
    prompt_file.write_text('{"scene":"city"}', encoding="utf-8")
    first_frame = tmp_path / "first.png"
    first_frame.write_bytes(b"first-image")
    last_frame = tmp_path / "last.jpg"
    last_frame.write_bytes(b"last-image")
    output_file = tmp_path / "outputs" / "generated.mp4"
    monkeypatch.setenv("ARK_API_KEY", "test-ark-key")

    captured_request = {}
    task_responses = iter(
        [
            {"id": "task-123", "status": "queued"},
            {"id": "task-123", "status": "running"},
            {
                "id": "task-123",
                "status": "succeeded",
                "content": {
                    "video_url": "https://example.com/generated.mp4",
                    "last_frame_url": "https://example.com/last-frame.png",
                },
            },
        ]
    )

    def fake_post(url, headers=None, json=None, timeout=None):
        captured_request["url"] = url
        captured_request["headers"] = headers
        captured_request["json"] = json
        captured_request["timeout"] = timeout
        return FakeResponse({"id": "task-123"})

    def fake_get(url, headers=None, timeout=None):
        if url.endswith("/contents/generations/tasks/task-123"):
            return FakeResponse(next(task_responses))
        if url == "https://example.com/generated.mp4":
            return FakeResponse(content=b"video-bytes")
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr(module.requests, "post", fake_post)
    monkeypatch.setattr(module.requests, "get", fake_get)
    monkeypatch.setattr(module.time, "sleep", lambda *_args, **_kwargs: None)

    message = module.generate_video(
        str(prompt_file),
        [str(first_frame), str(last_frame)],
        str(output_file),
        aspect_ratio="9:16",
    )

    assert message == f"The video has been generated successfully to {output_file}"
    assert captured_request["url"] == f"{module.ARK_BASE_URL}/contents/generations/tasks"
    assert captured_request["headers"]["Authorization"] == "Bearer test-ark-key"
    assert captured_request["json"]["model"] == module.DEFAULT_MODEL
    assert captured_request["json"]["ratio"] == "9:16"
    assert captured_request["json"]["content"][1]["role"] == "first_frame"
    assert captured_request["json"]["content"][2]["role"] == "last_frame"
    assert output_file.read_bytes() == b"video-bytes"


def test_generate_video_raises_for_failed_task(monkeypatch, tmp_path):
    module = load_video_generation_module()
    prompt_file = tmp_path / "prompt.json"
    prompt_file.write_text('{"scene":"city"}', encoding="utf-8")
    output_file = tmp_path / "generated.mp4"
    monkeypatch.setenv("ARK_API_KEY", "test-ark-key")

    def fake_post(url, headers=None, json=None, timeout=None):
        return FakeResponse({"id": "task-456"})

    def fake_get(url, headers=None, timeout=None):
        if url.endswith("/contents/generations/tasks/task-456"):
            return FakeResponse(
                {
                    "id": "task-456",
                    "status": "failed",
                    "error": {"message": "model is not available for API access"},
                }
            )
        raise AssertionError(f"Unexpected GET URL: {url}")

    monkeypatch.setattr(module.requests, "post", fake_post)
    monkeypatch.setattr(module.requests, "get", fake_get)

    with pytest.raises(RuntimeError, match="model is not available for API access"):
        module.generate_video(str(prompt_file), [], str(output_file))


def test_create_generation_task_surfaces_http_error_message(monkeypatch):
    module = load_video_generation_module()
    expected_message = f"Your account has not activated the model {module.DEFAULT_MODEL}."

    def fake_post(url, headers=None, json=None, timeout=None):
        response = FakeResponse(
            {
                "error": {
                    "code": "ModelNotOpen",
                    "message": expected_message,
                }
            },
            status_code=404,
        )
        response.text = f'{{"error":{{"code":"ModelNotOpen","message":"{expected_message}"}}}}'
        return response

    monkeypatch.setattr(module.requests, "post", fake_post)

    with pytest.raises(RuntimeError, match=module.DEFAULT_MODEL):
        module.create_generation_task({"model": module.DEFAULT_MODEL}, "test-ark-key")


def test_get_generation_task_retries_transient_network_error(monkeypatch):
    module = load_video_generation_module()
    call_count = {"value": 0}

    def fake_get(url, headers=None, timeout=None):
        call_count["value"] += 1
        if call_count["value"] == 1:
            raise requests.exceptions.SSLError("temporary eof")
        return FakeResponse({"id": "task-123", "status": "succeeded", "content": {"video_url": "https://example.com/video.mp4"}})

    monkeypatch.setattr(module.requests, "get", fake_get)
    monkeypatch.setattr(module.time, "sleep", lambda *_args, **_kwargs: None)

    response = module.get_generation_task("task-123", "test-ark-key")

    assert response["status"] == "succeeded"
    assert call_count["value"] == 2
