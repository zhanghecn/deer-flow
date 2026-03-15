from __future__ import annotations

from src.community.aio_sandbox.aio_sandbox_provider import AioSandboxProvider
from src.community.aio_sandbox.existing_backend import ExistingSandboxBackend
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


def test_aio_sandbox_provider_uses_existing_backend_for_base_url():
    provider = object.__new__(AioSandboxProvider)
    provider._config = {
        "provisioner_url": "",
        "base_url": "http://sandbox.internal:8080",
        "environment": {},
        "image": "sandbox:latest",
        "port": 8080,
        "container_prefix": "openagents-sandbox",
        "mounts": [],
        "auto_start": False,
    }

    backend = AioSandboxProvider._create_backend(provider)

    assert isinstance(backend, ExistingSandboxBackend)
    assert backend.base_url == "http://sandbox.internal:8080"


def test_aio_sandbox_provider_builds_thread_runtime_root_for_shared_existing_sandbox():
    provider = object.__new__(AioSandboxProvider)
    provider._config = {
        "base_url": "http://sandbox.internal:8080",
        "shared_data_mount_path": "/openagents",
    }

    runtime_root = AioSandboxProvider._runtime_root_for_thread(provider, "thread-1")

    assert runtime_root == "/openagents/threads/thread-1/user-data"
