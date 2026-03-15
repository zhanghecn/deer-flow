from __future__ import annotations

import threading
from pathlib import Path

from fastapi.testclient import TestClient

from deepagents.backends.protocol import ExecuteResponse

from src.config.paths import Paths
from src.remote.models import ConnectRemoteSessionRequest, RegisterRemoteSessionRequest
from src.remote.server import create_remote_relay_app
from src.remote.store import RemoteRelayStore
from src.runtime_backends.remote import build_remote_workspace_backend


def _make_paths(base_dir: Path) -> Paths:
    return Paths(base_dir=base_dir, skills_dir=base_dir / "skills")


def test_remote_relay_store_claims_requests_and_responses(tmp_path):
    paths = _make_paths(tmp_path / ".openagents")
    store = RemoteRelayStore(paths=paths, poll_interval_seconds=0.01)
    session = store.create_session(RegisterRemoteSessionRequest(client_name="tester"))
    store.connect_session(
        session.session_id,
        ConnectRemoteSessionRequest(workspace_root=str(tmp_path / "workspace")),
    )

    request = store.submit_request(
        session_id=session.session_id,
        operation="execute",
        payload={"command": "pwd", "timeout": 5},
        response_timeout_seconds=5,
    )
    claimed = store.claim_next_request(session.session_id, wait_seconds=0)

    assert claimed is not None
    assert claimed.request_id == request.request_id
    assert claimed.payload["command"] == "pwd"

    store.submit_response(
        session_id=session.session_id,
        request_id=request.request_id,
        success=True,
        payload={"output": "ok", "exit_code": 0, "truncated": False},
    )
    response = store.wait_for_response(
        session_id=session.session_id,
        request_id=request.request_id,
        timeout_seconds=1,
    )

    assert response.success is True
    assert response.payload["output"] == "ok"


def test_remote_workspace_backend_executes_via_relay(tmp_path):
    paths = _make_paths(tmp_path / ".openagents")
    store = RemoteRelayStore(paths=paths, poll_interval_seconds=0.01)
    session = store.create_session(RegisterRemoteSessionRequest(client_name="tester"))
    store.connect_session(
        session.session_id,
        ConnectRemoteSessionRequest(workspace_root=str(tmp_path / "workspace")),
    )
    backend = build_remote_workspace_backend(session_id=session.session_id, paths=paths)
    result_holder: dict[str, ExecuteResponse] = {}

    def _run_execute() -> None:
        result_holder["result"] = backend.execute("echo hello", timeout=5)

    thread = threading.Thread(target=_run_execute)
    thread.start()

    claimed = store.claim_next_request(session.session_id, wait_seconds=1)
    assert claimed is not None
    assert claimed.operation == "execute"
    assert claimed.payload["command"] == "echo hello"

    store.submit_response(
        session_id=session.session_id,
        request_id=claimed.request_id,
        success=True,
        payload={"output": "hello", "exit_code": 0, "truncated": False},
    )
    thread.join(timeout=2)

    assert thread.is_alive() is False
    assert result_holder["result"].output == "hello"
    assert result_holder["result"].exit_code == 0


def test_build_remote_workspace_backend_requires_connected_session(tmp_path):
    paths = _make_paths(tmp_path / ".openagents")
    store = RemoteRelayStore(paths=paths)
    session = store.create_session(RegisterRemoteSessionRequest(client_name="tester"))

    try:
        build_remote_workspace_backend(session_id=session.session_id, paths=paths)
    except RuntimeError as exc:
        assert "not connected" in str(exc)
    else:
        raise AssertionError("Expected disconnected remote session to be rejected.")


def test_remote_relay_server_registers_connects_and_polls(tmp_path):
    paths = _make_paths(tmp_path / ".openagents")
    store = RemoteRelayStore(paths=paths, poll_interval_seconds=0.01)
    with TestClient(create_remote_relay_app(store)) as client:
        register_response = client.post(
            "/api/remote/sessions/register",
            json={"client_name": "tester", "platform": "linux"},
        )
        assert register_response.status_code == 200
        register_payload = register_response.json()
        session_id = register_payload["session_id"]
        token = register_payload["client_token"]

        connect_response = client.post(
            f"/api/remote/sessions/{session_id}/connect",
            headers={"x-openagents-session-token": token},
            json={"workspace_root": str(tmp_path / "workspace")},
        )
        assert connect_response.status_code == 200
        assert connect_response.json()["status"] == "connected"

        request = store.submit_request(
            session_id=session_id,
            operation="download_files",
            payload={"paths": ["/mnt/user-data/outputs/demo.txt"]},
            response_timeout_seconds=5,
        )
        poll_response = client.get(
            f"/api/remote/sessions/{session_id}/requests/poll",
            headers={"x-openagents-session-token": token},
        )
        assert poll_response.status_code == 200
        assert poll_response.json()["request_id"] == request.request_id

        response_submit = client.post(
            f"/api/remote/sessions/{session_id}/responses/{request.request_id}",
            headers={"x-openagents-session-token": token},
            json={
                "success": True,
                "payload": {
                    "responses": [
                        {
                            "path": "/mnt/user-data/outputs/demo.txt",
                            "content_b64": "aGVsbG8=",
                            "error": None,
                        }
                    ]
                },
            },
        )
        assert response_submit.status_code == 200

        response = store.wait_for_response(
            session_id=session_id,
            request_id=request.request_id,
            timeout_seconds=1,
        )
        assert response.success is True
        assert response.payload["responses"][0]["path"] == "/mnt/user-data/outputs/demo.txt"
