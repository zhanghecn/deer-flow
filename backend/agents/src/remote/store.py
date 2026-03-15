from __future__ import annotations

import json
import secrets
import time
import uuid
from pathlib import Path
from typing import Any

from src.config.paths import Paths, get_paths

from .models import (
    ConnectRemoteSessionRequest,
    RemoteOperation,
    RemoteRequestEnvelope,
    RemoteResponseEnvelope,
    RemoteSessionRecord,
    RegisterRemoteSessionRequest,
)


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp-{uuid.uuid4().hex}")
    temp_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True), encoding="utf-8")
    temp_path.replace(path)


def _load_model(path: Path, model_cls):
    return model_cls.model_validate_json(path.read_text(encoding="utf-8"))


class RemoteRelayStore:
    """Filesystem-backed relay queue shared by runtime and remote clients.

    The LangGraph runtime writes request envelopes here. The remote CLI claims
    them through the relay HTTP server, executes them on the user machine, and
    writes response envelopes back to the same session directory.
    """

    def __init__(
        self,
        *,
        paths: Paths | None = None,
        poll_interval_seconds: float = 0.2,
    ) -> None:
        self._paths = paths or get_paths()
        self._poll_interval_seconds = poll_interval_seconds

    @property
    def paths(self) -> Paths:
        return self._paths

    def _session_dir(self, session_id: str) -> Path:
        return self._paths.remote_session_dir(session_id)

    def _session_file(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "session.json"

    def _pending_requests_dir(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "requests" / "pending"

    def _active_requests_dir(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "requests" / "active"

    def _responses_dir(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "responses"

    def _ensure_session_dirs(self, session_id: str) -> None:
        self._pending_requests_dir(session_id).mkdir(parents=True, exist_ok=True)
        self._active_requests_dir(session_id).mkdir(parents=True, exist_ok=True)
        self._responses_dir(session_id).mkdir(parents=True, exist_ok=True)

    def create_session(self, request: RegisterRemoteSessionRequest) -> RemoteSessionRecord:
        while True:
            session_id = uuid.uuid4().hex[:16]
            session_file = self._session_file(session_id)
            if not session_file.exists():
                break

        created_at = _utc_now()
        record = RemoteSessionRecord(
            session_id=session_id,
            client_token=secrets.token_urlsafe(24),
            created_at=created_at,
            updated_at=created_at,
            status="registered",
            client_name=request.client_name,
            cli_version=request.cli_version,
            platform=request.platform,
            hostname=request.hostname,
        )
        self._ensure_session_dirs(session_id)
        _atomic_write_json(session_file, record.model_dump())
        return record

    def session_exists(self, session_id: str) -> bool:
        return self._session_file(session_id).exists()

    def get_session(self, session_id: str) -> RemoteSessionRecord:
        session_file = self._session_file(session_id)
        if not session_file.exists():
            raise FileNotFoundError(f"Remote session '{session_id}' not found.")
        return _load_model(session_file, RemoteSessionRecord)

    def list_sessions(self) -> list[RemoteSessionRecord]:
        sessions_dir = self._paths.remote_sessions_dir
        if not sessions_dir.exists():
            return []

        records: list[RemoteSessionRecord] = []
        for session_dir in sorted(sessions_dir.iterdir()):
            session_file = session_dir / "session.json"
            if not session_file.exists():
                continue
            try:
                records.append(_load_model(session_file, RemoteSessionRecord))
            except Exception:
                continue
        return records

    def update_session(self, record: RemoteSessionRecord) -> RemoteSessionRecord:
        updated = record.model_copy(update={"updated_at": _utc_now()})
        _atomic_write_json(self._session_file(record.session_id), updated.model_dump())
        return updated

    def connect_session(
        self,
        session_id: str,
        request: ConnectRemoteSessionRequest,
    ) -> RemoteSessionRecord:
        record = self.get_session(session_id)
        connected_at = _utc_now()
        return self.update_session(
            record.model_copy(
                update={
                    "status": "connected",
                    "workspace_root": request.workspace_root,
                    "runtime_root": request.runtime_root,
                    "client_name": request.client_name or record.client_name,
                    "cli_version": request.cli_version or record.cli_version,
                    "platform": request.platform or record.platform,
                    "hostname": request.hostname or record.hostname,
                    "last_heartbeat_at": connected_at,
                }
            )
        )

    def heartbeat_session(self, session_id: str, *, status: str = "connected") -> RemoteSessionRecord:
        record = self.get_session(session_id)
        return self.update_session(
            record.model_copy(
                update={
                    "status": status,
                    "last_heartbeat_at": _utc_now(),
                }
            )
        )

    def submit_request(
        self,
        *,
        session_id: str,
        operation: RemoteOperation,
        payload: dict[str, Any],
        response_timeout_seconds: int,
    ) -> RemoteRequestEnvelope:
        self.get_session(session_id)
        self._ensure_session_dirs(session_id)

        envelope = RemoteRequestEnvelope(
            request_id=uuid.uuid4().hex,
            session_id=session_id,
            operation=operation,
            created_at=_utc_now(),
            response_timeout_seconds=response_timeout_seconds,
            payload=payload,
        )
        _atomic_write_json(
            self._pending_requests_dir(session_id) / f"{envelope.request_id}.json",
            envelope.model_dump(),
        )
        return envelope

    def claim_next_request(
        self,
        session_id: str,
        *,
        wait_seconds: int = 20,
    ) -> RemoteRequestEnvelope | None:
        deadline = time.monotonic() + max(wait_seconds, 0)
        self._ensure_session_dirs(session_id)

        while True:
            pending_files = sorted(self._pending_requests_dir(session_id).glob("*.json"))
            for pending_file in pending_files:
                active_file = self._active_requests_dir(session_id) / pending_file.name
                try:
                    pending_file.replace(active_file)
                except FileNotFoundError:
                    continue
                return _load_model(active_file, RemoteRequestEnvelope)

            if time.monotonic() >= deadline:
                return None
            time.sleep(self._poll_interval_seconds)

    def submit_response(
        self,
        *,
        session_id: str,
        request_id: str,
        success: bool,
        payload: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> RemoteResponseEnvelope:
        response = RemoteResponseEnvelope(
            request_id=request_id,
            session_id=session_id,
            created_at=_utc_now(),
            success=success,
            payload=payload or {},
            error=error,
        )
        _atomic_write_json(
            self._responses_dir(session_id) / f"{request_id}.json",
            response.model_dump(),
        )
        for candidate in (
            self._active_requests_dir(session_id) / f"{request_id}.json",
            self._pending_requests_dir(session_id) / f"{request_id}.json",
        ):
            candidate.unlink(missing_ok=True)
        return response

    def wait_for_response(
        self,
        *,
        session_id: str,
        request_id: str,
        timeout_seconds: int,
    ) -> RemoteResponseEnvelope:
        deadline = time.monotonic() + max(timeout_seconds, 0)
        response_file = self._responses_dir(session_id) / f"{request_id}.json"

        while True:
            if response_file.exists():
                response = _load_model(response_file, RemoteResponseEnvelope)
                response_file.unlink(missing_ok=True)
                return response

            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Timed out waiting for remote response '{request_id}' in session '{session_id}'."
                )
            time.sleep(self._poll_interval_seconds)

