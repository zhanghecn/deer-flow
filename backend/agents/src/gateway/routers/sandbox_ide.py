from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from src.sandbox.ide_sessions import (
    RUNTIME_IDE_MODE,
    SandboxIDEAccessDeniedError,
    SandboxIDEError,
    SandboxIDEExpiredError,
    SandboxIDENotFoundError,
    SandboxIDEUnsupportedError,
    get_sandbox_ide_session_manager,
)

router = APIRouter(prefix="/api/sandbox-ide", tags=["sandbox-ide"])


class OpenSandboxIDESessionRequest(BaseModel):
    thread_id: str = Field(..., description="Thread whose sandbox should be inspected.")
    mode: Literal["runtime", "authoring"] = Field(
        default=RUNTIME_IDE_MODE,
        description="Which thread-local root should be exposed in the IDE.",
    )
    target_path: str | None = Field(
        default=None,
        description="Optional virtual path to focus when the IDE opens.",
    )


class SandboxIDESessionResponse(BaseModel):
    session_id: str
    access_token: str
    mode: Literal["runtime", "authoring"]
    target_path: str
    relative_url: str
    public_base_path: str
    expires_at: str


class SandboxIDEProxyTargetResponse(BaseModel):
    session_id: str
    access_token: str
    upstream_base_url: str
    upstream_path_prefix: str
    expires_at: str


def _http_error(exc: SandboxIDEError) -> HTTPException:
    if isinstance(exc, SandboxIDENotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, SandboxIDEAccessDeniedError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, SandboxIDEExpiredError):
        return HTTPException(status_code=410, detail=str(exc))
    if isinstance(exc, SandboxIDEUnsupportedError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/sessions",
    response_model=SandboxIDESessionResponse,
    summary="Create or reuse a thread sandbox IDE session",
)
async def open_sandbox_ide_session(
    payload: OpenSandboxIDESessionRequest,
    x_user_id: str | None = Header(default=None, alias="x-user-id"),
) -> SandboxIDESessionResponse:
    manager = get_sandbox_ide_session_manager()
    try:
        # Sandbox resolution and code-server startup touch the sandbox control
        # plane and local state store, so keep that logic synchronous but move
        # it off the ASGI event loop.
        session = await asyncio.to_thread(
            manager.open_session,
            thread_id=payload.thread_id,
            mode=payload.mode,
            target_path=payload.target_path,
            user_id=x_user_id,
        )
    except SandboxIDEError as exc:
        raise _http_error(exc) from exc
    return SandboxIDESessionResponse.model_validate(asdict(session))


@router.get(
    "/sessions/{session_id}/{access_token}",
    response_model=SandboxIDEProxyTargetResponse,
    summary="Resolve a sandbox IDE proxy target",
)
async def resolve_sandbox_ide_proxy_target(
    session_id: str,
    access_token: str,
    x_user_id: str | None = Header(default=None, alias="x-user-id"),
) -> SandboxIDEProxyTargetResponse:
    manager = get_sandbox_ide_session_manager()
    try:
        # Expired-session cleanup can terminate a detached IDE process, so this
        # lookup follows the same off-event-loop rule as session creation.
        target = await asyncio.to_thread(
            manager.resolve_proxy_target,
            session_id=session_id,
            access_token=access_token,
            user_id=x_user_id,
        )
    except SandboxIDEError as exc:
        raise _http_error(exc) from exc
    return SandboxIDEProxyTargetResponse.model_validate(asdict(target))
