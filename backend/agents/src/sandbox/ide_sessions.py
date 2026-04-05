from __future__ import annotations

import hmac
import logging
import random
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import urlencode

import httpx

from src.community.aio_sandbox.aio_sandbox import AioSandbox
from src.community.aio_sandbox.aio_sandbox_provider import AioSandboxProvider
from src.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from src.config.runtime_db import ThreadBinding, get_runtime_db_store
from src.runtime_backends.sandbox import (
    LOCAL_SANDBOX_PROVIDER,
    get_sandbox_provider,
    resolve_default_execution_backend,
    resolve_sandbox_provider,
)

logger = logging.getLogger(__name__)

RUNTIME_IDE_MODE = "runtime"
AUTHORING_IDE_MODE = "authoring"
ALLOWED_IDE_MODES = {RUNTIME_IDE_MODE, AUTHORING_IDE_MODE}
DEFAULT_IDE_SESSION_TTL_SECONDS = 15 * 60
DEFAULT_IDE_READY_TIMEOUT_SECONDS = 20
IDE_PORT_MIN = 20000
IDE_PORT_MAX = 45000


class SandboxIDEError(RuntimeError):
    """Base error for sandbox IDE session failures."""


class SandboxIDEAccessDeniedError(SandboxIDEError):
    """Raised when a caller is not allowed to access a thread IDE session."""


class SandboxIDEExpiredError(SandboxIDEError):
    """Raised when an IDE session has already expired."""


class SandboxIDENotFoundError(SandboxIDEError):
    """Raised when an IDE session cannot be resolved."""


class SandboxIDEUnsupportedError(SandboxIDEError):
    """Raised when the current runtime backend does not support browser IDEs."""


@dataclass(frozen=True)
class SandboxIDETarget:
    mode: str
    bind_source: str
    visible_path: str


@dataclass(frozen=True)
class ResolvedSandboxContext:
    owner_user_id: str | None
    sandbox_id: str
    sandbox: AioSandbox


@dataclass
class SandboxIDESessionRecord:
    session_id: str
    access_token: str
    thread_id: str
    owner_user_id: str | None
    mode: str
    sandbox_id: str
    sandbox: AioSandbox
    bind_source: str
    state_root: str
    visible_state_root: str
    port: int
    pid: int
    public_base_path: str
    upstream_path_prefix: str
    created_at: float
    expires_at: float


@dataclass(frozen=True)
class SandboxIDESessionDescriptor:
    session_id: str
    access_token: str
    mode: str
    target_path: str
    relative_url: str
    public_base_path: str
    expires_at: str


@dataclass(frozen=True)
class SandboxIDEProxyTarget:
    session_id: str
    access_token: str
    upstream_base_url: str
    upstream_path_prefix: str
    expires_at: str


def _isoformat_utc(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).isoformat().replace("+00:00", "Z")


def _thread_key(thread_id: str, mode: str) -> tuple[str, str]:
    return (thread_id, mode)


class SandboxIDESessionManager:
    """Control-plane service that allocates and validates sandbox IDE sessions."""

    def __init__(
        self,
        *,
        ttl_seconds: int = DEFAULT_IDE_SESSION_TTL_SECONDS,
        ready_timeout_seconds: int = DEFAULT_IDE_READY_TIMEOUT_SECONDS,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._ready_timeout_seconds = ready_timeout_seconds
        self._http_client = http_client or httpx.Client(timeout=2.0, follow_redirects=False)
        self._lock = threading.Lock()
        self._sessions_by_id: dict[str, SandboxIDESessionRecord] = {}
        self._sessions_by_thread: dict[tuple[str, str], str] = {}

    def open_session(
        self,
        *,
        thread_id: str,
        mode: str = RUNTIME_IDE_MODE,
        target_path: str | None = None,
        user_id: str | None = None,
    ) -> SandboxIDESessionDescriptor:
        self._validate_thread_id(thread_id)
        normalized_mode = self._normalize_mode(mode)
        self._cleanup_expired_sessions()

        sandbox_context = self._resolve_thread_sandbox(thread_id=thread_id, user_id=user_id)
        target = self._resolve_target(
            sandbox=sandbox_context.sandbox,
            mode=normalized_mode,
            target_path=target_path,
        )

        session = self._get_reusable_session(
            thread_id=thread_id,
            mode=normalized_mode,
            sandbox_id=sandbox_context.sandbox_id,
        )
        if session is None:
            session = self._create_session(
                thread_id=thread_id,
                owner_user_id=sandbox_context.owner_user_id,
                mode=normalized_mode,
                sandbox_id=sandbox_context.sandbox_id,
                sandbox=sandbox_context.sandbox,
                target=target,
            )

        return self._build_descriptor(session=session, target_path=target.visible_path)

    def resolve_proxy_target(
        self,
        *,
        session_id: str,
        access_token: str,
        user_id: str | None = None,
    ) -> SandboxIDEProxyTarget:
        self._cleanup_expired_sessions()
        with self._lock:
            session = self._sessions_by_id.get(session_id)
        if session is None:
            raise SandboxIDENotFoundError(f"Sandbox IDE session '{session_id}' was not found.")
        if not hmac.compare_digest(session.access_token, access_token):
            raise SandboxIDEAccessDeniedError("Sandbox IDE access token is invalid.")
        if session.owner_user_id and user_id and session.owner_user_id != user_id:
            raise SandboxIDEAccessDeniedError(
                f"Sandbox IDE session '{session_id}' belongs to another user."
            )

        self._touch_session(session)
        return SandboxIDEProxyTarget(
            session_id=session.session_id,
            access_token=session.access_token,
            upstream_base_url=session.sandbox.base_url.rstrip("/"),
            upstream_path_prefix=session.upstream_path_prefix,
            expires_at=_isoformat_utc(session.expires_at),
        )

    def _validate_thread_id(self, thread_id: str) -> None:
        # Reuse the canonical path builder for thread-id validation so the IDE
        # control plane follows the same allowed identifier contract as runtime
        # seeding and gateway draft workspaces.
        get_paths().thread_dir(thread_id)

    def _normalize_mode(self, mode: str) -> str:
        normalized = str(mode or "").strip().lower()
        if normalized not in ALLOWED_IDE_MODES:
            raise SandboxIDEError(
                f"Unsupported sandbox IDE mode '{mode}'. Expected one of {sorted(ALLOWED_IDE_MODES)}."
            )
        return normalized

    def _resolve_thread_sandbox(
        self,
        *,
        thread_id: str,
        user_id: str | None,
    ) -> ResolvedSandboxContext:
        binding = self._get_thread_binding(thread_id)
        owner_user_id = binding.user_id if binding is not None else None
        if owner_user_id and user_id and owner_user_id != user_id:
            raise SandboxIDEAccessDeniedError(
                f"Thread '{thread_id}' belongs to another user."
            )

        if binding is not None and binding.execution_backend == "remote":
            raise SandboxIDEUnsupportedError(
                "Remote execution threads do not support sandbox IDE access yet."
            )

        provider_path = resolve_sandbox_provider()
        if provider_path == LOCAL_SANDBOX_PROVIDER or resolve_default_execution_backend() != "sandbox":
            raise SandboxIDEUnsupportedError(
                "Sandbox IDE access requires the managed sandbox execution backend."
            )

        provider = get_sandbox_provider(provider_path)
        if not isinstance(provider, AioSandboxProvider):
            raise SandboxIDEUnsupportedError(
                f"Sandbox provider '{provider_path}' does not expose AIO browser IDE sessions."
            )

        sandbox_id, sandbox = provider.resolve_thread_sandbox(thread_id)
        return ResolvedSandboxContext(
            owner_user_id=owner_user_id or user_id,
            sandbox_id=sandbox_id,
            sandbox=sandbox,
        )

    def _get_thread_binding(self, thread_id: str) -> ThreadBinding | None:
        try:
            return get_runtime_db_store().get_thread_binding(thread_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load thread binding for sandbox IDE session: %s", exc)
            return None

    def _resolve_target(
        self,
        *,
        sandbox: AioSandbox,
        mode: str,
        target_path: str | None,
    ) -> SandboxIDETarget:
        requested_root = (
            VIRTUAL_PATH_PREFIX
            if mode == RUNTIME_IDE_MODE
            else f"{VIRTUAL_PATH_PREFIX}/authoring"
        )
        requested_target = (
            f"{VIRTUAL_PATH_PREFIX}/workspace"
            if mode == RUNTIME_IDE_MODE
            else f"{VIRTUAL_PATH_PREFIX}/authoring"
        )
        if target_path and str(target_path).strip():
            requested_target = str(target_path).strip()

        bind_source = sandbox._normalize_runtime_path(requested_root)
        actual_target = sandbox._normalize_runtime_path(requested_target)
        try:
            relative_target = PurePosixPath(actual_target).relative_to(PurePosixPath(bind_source))
        except ValueError as exc:
            raise SandboxIDEAccessDeniedError(
                f"Sandbox IDE target '{requested_target}' escapes the visible {mode} root."
            ) from exc
        visible_target = PurePosixPath(VIRTUAL_PATH_PREFIX).joinpath(relative_target)
        visible_target_text = str(visible_target)
        if visible_target_text == ".":
            visible_target_text = VIRTUAL_PATH_PREFIX
        if not visible_target_text.startswith(VIRTUAL_PATH_PREFIX):
            raise SandboxIDEAccessDeniedError(
                f"Sandbox IDE target '{requested_target}' escapes the visible runtime root."
            )

        return SandboxIDETarget(
            mode=mode,
            bind_source=bind_source,
            visible_path=visible_target_text,
        )

    def _get_reusable_session(
        self,
        *,
        thread_id: str,
        mode: str,
        sandbox_id: str,
    ) -> SandboxIDESessionRecord | None:
        with self._lock:
            session_id = self._sessions_by_thread.get(_thread_key(thread_id, mode))
            if session_id is None:
                return None
            session = self._sessions_by_id.get(session_id)
        if session is None or session.sandbox_id != sandbox_id:
            return None
        if not self._is_session_ready(session):
            self._drop_session(session_id, terminate=True)
            return None
        self._touch_session(session)
        return session

    def _create_session(
        self,
        *,
        thread_id: str,
        owner_user_id: str | None,
        mode: str,
        sandbox_id: str,
        sandbox: AioSandbox,
        target: SandboxIDETarget,
    ) -> SandboxIDESessionRecord:
        session_id = secrets.token_hex(8)
        access_token = secrets.token_urlsafe(18)
        public_base_path = f"/sandbox-ide/{session_id}/{access_token}"
        bind_root_name = PurePosixPath(target.bind_source).name
        state_root = f"{target.bind_source}/.openagents/runtime-ide/{bind_root_name}/{session_id}"
        visible_state_root = f"{VIRTUAL_PATH_PREFIX}/.openagents/runtime-ide/{bind_root_name}/{session_id}"

        last_error: Exception | None = None
        for _ in range(5):
            port = self._allocate_port()
            try:
                pid = sandbox.launch_detached_code_server(
                    bind_source=target.bind_source,
                    visible_workdir=VIRTUAL_PATH_PREFIX,
                    state_root=state_root,
                    visible_state_root=visible_state_root,
                    port=port,
                    public_base_path=public_base_path,
                )
                session = SandboxIDESessionRecord(
                    session_id=session_id,
                    access_token=access_token,
                    thread_id=thread_id,
                    owner_user_id=owner_user_id,
                    mode=mode,
                    sandbox_id=sandbox_id,
                    sandbox=sandbox,
                    bind_source=target.bind_source,
                    state_root=state_root,
                    visible_state_root=visible_state_root,
                    port=port,
                    pid=pid,
                    public_base_path=public_base_path,
                    upstream_path_prefix=f"/proxy/{port}",
                    created_at=time.time(),
                    expires_at=time.time() + self._ttl_seconds,
                )
                if not self._wait_for_session_ready(session):
                    sandbox.terminate_detached_process(pid)
                    raise SandboxIDEError(
                        f"Sandbox IDE session '{session_id}' did not become ready on port {port}."
                    )
                with self._lock:
                    self._sessions_by_id[session_id] = session
                    self._sessions_by_thread[_thread_key(thread_id, mode)] = session_id
                return session
            except Exception as exc:  # noqa: BLE001
                last_error = exc

        raise SandboxIDEError(
            f"Failed to allocate sandbox IDE session for thread '{thread_id}': {last_error}"
        ) from last_error

    def _allocate_port(self) -> int:
        with self._lock:
            active_ports = {session.port for session in self._sessions_by_id.values()}
        while True:
            port = random.randint(IDE_PORT_MIN, IDE_PORT_MAX)
            if port not in active_ports:
                return port

    def _wait_for_session_ready(self, session: SandboxIDESessionRecord) -> bool:
        deadline = time.time() + self._ready_timeout_seconds
        while time.time() < deadline:
            if self._is_session_ready(session):
                return True
            time.sleep(0.5)
        return False

    def _is_session_ready(self, session: SandboxIDESessionRecord) -> bool:
        try:
            response = self._http_client.get(
                f"{session.sandbox.base_url.rstrip('/')}/proxy/{session.port}/healthz"
            )
        except httpx.HTTPError:
            return False
        return response.status_code == 200

    def _build_descriptor(
        self,
        *,
        session: SandboxIDESessionRecord,
        target_path: str,
    ) -> SandboxIDESessionDescriptor:
        query = urlencode({"folder": target_path})
        relative_url = f"{session.public_base_path}/"
        if query:
            relative_url = f"{relative_url}?{query}"
        return SandboxIDESessionDescriptor(
            session_id=session.session_id,
            access_token=session.access_token,
            mode=session.mode,
            target_path=target_path,
            relative_url=relative_url,
            public_base_path=session.public_base_path,
            expires_at=_isoformat_utc(session.expires_at),
        )

    def _touch_session(self, session: SandboxIDESessionRecord) -> None:
        with self._lock:
            current = self._sessions_by_id.get(session.session_id)
            if current is None:
                return
            current.expires_at = time.time() + self._ttl_seconds

    def _cleanup_expired_sessions(self) -> None:
        now = time.time()
        with self._lock:
            expired_session_ids = [
                session_id
                for session_id, session in self._sessions_by_id.items()
                if session.expires_at <= now
            ]
        for session_id in expired_session_ids:
            self._drop_session(session_id, terminate=True)

    def _drop_session(self, session_id: str, *, terminate: bool) -> None:
        with self._lock:
            session = self._sessions_by_id.pop(session_id, None)
            if session is None:
                return
            self._sessions_by_thread.pop(_thread_key(session.thread_id, session.mode), None)
        if terminate:
            try:
                session.sandbox.terminate_detached_process(session.pid)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to terminate expired sandbox IDE session '%s': %s", session_id, exc)


_manager: SandboxIDESessionManager | None = None
_manager_lock = threading.Lock()


def get_sandbox_ide_session_manager() -> SandboxIDESessionManager:
    global _manager
    if _manager is not None:
        return _manager

    with _manager_lock:
        if _manager is None:
            _manager = SandboxIDESessionManager()
        return _manager
