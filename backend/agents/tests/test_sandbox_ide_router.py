from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.gateway.routers import sandbox_ide
from src.sandbox.ide_sessions import (
    SandboxIDEProxyTarget,
    SandboxIDESessionDescriptor,
)


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(sandbox_ide.router)
    return app


def test_open_sandbox_ide_session_offloads_manager_call() -> None:
    descriptor = SandboxIDESessionDescriptor(
        session_id="session-1",
        access_token="token-1",
        mode="runtime",
        target_path="/mnt/user-data/workspace",
        relative_url="/sandbox-ide/session-1/token-1/?folder=%2Fmnt%2Fuser-data%2Fworkspace",
        public_base_path="/sandbox-ide/session-1/token-1",
        expires_at="2026-04-05T17:00:00Z",
    )
    manager = Mock()
    to_thread = AsyncMock(return_value=descriptor)

    with (
        patch(
            "src.gateway.routers.sandbox_ide.get_sandbox_ide_session_manager",
            return_value=manager,
        ),
        patch("src.gateway.routers.sandbox_ide.asyncio.to_thread", to_thread),
    ):
        with TestClient(_make_test_app()) as client:
            response = client.post(
                "/api/sandbox-ide/sessions",
                headers={"x-user-id": "user-1"},
                json={
                    "thread_id": "thread-1",
                    "mode": "runtime",
                    "target_path": "/mnt/user-data/workspace",
                },
            )

    assert response.status_code == 200
    assert response.json()["session_id"] == "session-1"
    to_thread.assert_awaited_once_with(
        manager.open_session,
        thread_id="thread-1",
        mode="runtime",
        target_path="/mnt/user-data/workspace",
        user_id="user-1",
    )


def test_resolve_sandbox_ide_proxy_target_offloads_manager_call() -> None:
    target = SandboxIDEProxyTarget(
        session_id="session-1",
        access_token="token-1",
        upstream_base_url="http://sandbox.test",
        upstream_path_prefix="/proxy/20001",
        expires_at="2026-04-05T17:00:00Z",
    )
    manager = Mock()
    to_thread = AsyncMock(return_value=target)

    with (
        patch(
            "src.gateway.routers.sandbox_ide.get_sandbox_ide_session_manager",
            return_value=manager,
        ),
        patch("src.gateway.routers.sandbox_ide.asyncio.to_thread", to_thread),
    ):
        with TestClient(_make_test_app()) as client:
            response = client.get(
                "/api/sandbox-ide/sessions/session-1/token-1",
                headers={"x-user-id": "user-1"},
            )

    assert response.status_code == 200
    assert response.json()["upstream_base_url"] == "http://sandbox.test"
    to_thread.assert_awaited_once_with(
        manager.resolve_proxy_target,
        session_id="session-1",
        access_token="token-1",
        user_id="user-1",
    )
