from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

RemoteOperation = Literal[
    "execute",
    "ls_info",
    "read",
    "grep_raw",
    "glob_info",
    "write",
    "edit",
    "upload_files",
    "download_files",
]
RemoteSessionStatus = Literal["registered", "connected", "disconnected"]


class RemoteSessionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    client_token: str
    created_at: str
    updated_at: str
    status: RemoteSessionStatus = "registered"
    client_name: str | None = None
    cli_version: str | None = None
    platform: str | None = None
    hostname: str | None = None
    workspace_root: str | None = None
    runtime_root: str | None = None
    last_heartbeat_at: str | None = None


class RemoteRequestEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str
    session_id: str
    operation: RemoteOperation
    created_at: str
    response_timeout_seconds: int
    payload: dict[str, Any] = Field(default_factory=dict)


class RemoteResponseEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str
    session_id: str
    created_at: str
    success: bool
    payload: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class RegisterRemoteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_name: str | None = None
    cli_version: str | None = None
    platform: str | None = None
    hostname: str | None = None


class ConnectRemoteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_root: str
    runtime_root: str | None = None
    client_name: str | None = None
    cli_version: str | None = None
    platform: str | None = None
    hostname: str | None = None


class HeartbeatRemoteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: RemoteSessionStatus = "connected"


class SubmitRemoteResponseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    payload: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class RemoteSessionCreatedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    client_token: str
    created_at: str

