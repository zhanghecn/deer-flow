from __future__ import annotations

from src.community.aio_sandbox.aio_sandbox_provider import AioSandboxProvider
from src.community.aio_sandbox.remote_backend import RemoteSandboxBackend


def test_remote_backend_sends_environment_to_provisioner(monkeypatch):
    captured: dict[str, object] = {}

    class DummyResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"sandbox_url": "http://sandbox.test"}

    def fake_post(url: str, json: dict[str, object], timeout: int) -> DummyResponse:
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return DummyResponse()

    monkeypatch.setattr("src.community.aio_sandbox.remote_backend.requests.post", fake_post)

    backend = RemoteSandboxBackend(
        provisioner_url="http://provisioner:8002",
        environment={"GEMINI_API_KEY": "secret"},
    )

    sandbox_info = backend.create("thread-1", "sandbox-1")

    assert sandbox_info.sandbox_url == "http://sandbox.test"
    assert captured["url"] == "http://provisioner:8002/api/sandboxes"
    assert captured["timeout"] == 30
    assert captured["json"] == {
        "sandbox_id": "sandbox-1",
        "thread_id": "thread-1",
        "environment": {"GEMINI_API_KEY": "secret"},
    }


def test_aio_sandbox_provider_passes_environment_to_remote_backend():
    provider = object.__new__(AioSandboxProvider)
    provider._config = {
        "provisioner_url": "http://provisioner:8002",
        "environment": {"GEMINI_API_KEY": "secret"},
        "image": "sandbox:latest",
        "port": 8080,
        "container_prefix": "openagents-sandbox",
        "mounts": [],
    }

    backend = AioSandboxProvider._create_backend(provider)

    assert isinstance(backend, RemoteSandboxBackend)
    assert backend.provisioner_url == "http://provisioner:8002"
    assert backend.environment == {"GEMINI_API_KEY": "secret"}
