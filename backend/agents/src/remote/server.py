from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Response, status

from .models import (
    ConnectRemoteSessionRequest,
    HeartbeatRemoteSessionRequest,
    RegisterRemoteSessionRequest,
    RemoteSessionCreatedResponse,
    SubmitRemoteResponseRequest,
)
from .store import RemoteRelayStore

logger = logging.getLogger(__name__)

DEFAULT_REMOTE_RELAY_HOST = "127.0.0.1"
DEFAULT_REMOTE_RELAY_PORT = 2025
_SIDE_CAR_LOCK = threading.Lock()
_SIDE_CAR_HANDLE: "RemoteRelayServerHandle | None" = None


def create_remote_relay_app(store: RemoteRelayStore | None = None) -> FastAPI:
    relay_store = store or RemoteRelayStore()
    app = FastAPI(title="OpenAgents Remote Relay", version="0.1.0")

    def _require_session_token(
        session_id: str,
        x_openagents_session_token: str | None = Header(default=None),
    ) -> None:
        if not x_openagents_session_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing session token.")
        session = relay_store.get_session(session_id)
        if session.client_token != x_openagents_session_token:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid session token.")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/remote/sessions/register", response_model=RemoteSessionCreatedResponse)
    async def register_session(request: RegisterRemoteSessionRequest) -> RemoteSessionCreatedResponse:
        record = relay_store.create_session(request)
        return RemoteSessionCreatedResponse(
            session_id=record.session_id,
            client_token=record.client_token,
            created_at=record.created_at,
        )

    @app.get("/api/remote/sessions")
    async def list_sessions() -> dict[str, list[dict]]:
        return {"sessions": [record.model_dump(exclude={"client_token"}) for record in relay_store.list_sessions()]}

    @app.get("/api/remote/sessions/{session_id}")
    async def get_session(session_id: str) -> dict:
        return relay_store.get_session(session_id).model_dump(exclude={"client_token"})

    @app.post("/api/remote/sessions/{session_id}/connect")
    async def connect_session(
        session_id: str,
        request: ConnectRemoteSessionRequest,
        _: None = Depends(_require_session_token),
    ) -> dict:
        return relay_store.connect_session(session_id, request).model_dump(exclude={"client_token"})

    @app.post("/api/remote/sessions/{session_id}/heartbeat")
    async def heartbeat_session(
        session_id: str,
        request: HeartbeatRemoteSessionRequest,
        _: None = Depends(_require_session_token),
    ) -> dict:
        return relay_store.heartbeat_session(session_id, status=request.status).model_dump(exclude={"client_token"})

    @app.get("/api/remote/sessions/{session_id}/requests/poll", response_model=None)
    async def poll_request(
        session_id: str,
        wait: int = 20,
        _: None = Depends(_require_session_token),
    ):
        request = relay_store.claim_next_request(session_id, wait_seconds=wait)
        if request is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return request.model_dump()

    @app.post("/api/remote/sessions/{session_id}/responses/{request_id}")
    async def submit_response(
        session_id: str,
        request_id: str,
        request: SubmitRemoteResponseRequest,
        _: None = Depends(_require_session_token),
    ) -> dict:
        return relay_store.submit_response(
            session_id=session_id,
            request_id=request_id,
            success=request.success,
            payload=request.payload,
            error=request.error,
        ).model_dump()

    return app


@dataclass(frozen=True)
class RemoteRelayServerHandle:
    host: str
    port: int
    thread: threading.Thread


def _relay_enabled() -> bool:
    raw = str(os.getenv("OPENAGENTS_REMOTE_RELAY_ENABLED", "true")).strip().lower()
    return raw not in {"0", "false", "no", "off"}


def start_remote_relay_sidecar() -> RemoteRelayServerHandle | None:
    global _SIDE_CAR_HANDLE

    if not _relay_enabled():
        logger.info("Remote relay sidecar is disabled.")
        return None

    with _SIDE_CAR_LOCK:
        if _SIDE_CAR_HANDLE is not None:
            return _SIDE_CAR_HANDLE

        host = str(os.getenv("OPENAGENTS_REMOTE_RELAY_HOST", DEFAULT_REMOTE_RELAY_HOST)).strip() or DEFAULT_REMOTE_RELAY_HOST
        port = int(str(os.getenv("OPENAGENTS_REMOTE_RELAY_PORT", DEFAULT_REMOTE_RELAY_PORT)).strip() or DEFAULT_REMOTE_RELAY_PORT)
        app = create_remote_relay_app()
        config = uvicorn.Config(app=app, host=host, port=port, log_level="info")
        server = uvicorn.Server(config=config)

        def _run() -> None:
            server.run()

        thread = threading.Thread(
            target=_run,
            name="openagents-remote-relay",
            daemon=True,
        )
        thread.start()
        time.sleep(0.2)

        _SIDE_CAR_HANDLE = RemoteRelayServerHandle(host=host, port=port, thread=thread)
        logger.info("Started remote relay sidecar on http://%s:%s", host, port)
        return _SIDE_CAR_HANDLE
