from __future__ import annotations

from dataclasses import dataclass

import pytest

from src.sandbox import ide_sessions as ide_sessions_module


class _FakeSandbox:
    def __init__(self, runtime_root: str):
        self.base_url = "http://sandbox.test"
        self.runtime_root = runtime_root.rstrip("/")
        self.launch_calls: list[dict[str, object]] = []
        self.terminated_pids: list[int] = []

    def _normalize_runtime_path(self, path: str) -> str:
        normalized = str(path).strip()
        replacements = {
            "/mnt/user-data": self.runtime_root,
            "/workspace": f"{self.runtime_root}/workspace",
            "/uploads": f"{self.runtime_root}/uploads",
            "/outputs": f"{self.runtime_root}/outputs",
            "/agents": f"{self.runtime_root}/agents",
            "/authoring": f"{self.runtime_root}/authoring",
        }
        for alias, target in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
            if normalized == alias or normalized.startswith(f"{alias}/"):
                return f"{target}{normalized[len(alias):]}"
        return normalized

    def _to_virtual_runtime_path(self, path: str) -> str:
        normalized = str(path).strip()
        if normalized == self.runtime_root:
            return "/mnt/user-data"
        if normalized.startswith(f"{self.runtime_root}/"):
            return f"/mnt/user-data{normalized[len(self.runtime_root):]}"
        return normalized

    def launch_detached_code_server(self, **kwargs) -> int:
        self.launch_calls.append(kwargs)
        return 4242

    def terminate_detached_process(self, pid: int) -> None:
        self.terminated_pids.append(pid)


@dataclass(frozen=True)
class _ResolvedContext:
    owner_user_id: str | None
    sandbox_id: str
    sandbox: _FakeSandbox


class _TestManager(ide_sessions_module.SandboxIDESessionManager):
    def __init__(self, sandbox: _FakeSandbox, **kwargs):
        super().__init__(**kwargs)
        self._sandbox = sandbox
        self.ready = True

    def _resolve_thread_sandbox(self, *, thread_id: str, user_id: str | None):
        return _ResolvedContext(
            owner_user_id=user_id or "user-1",
            sandbox_id=f"sandbox-{thread_id}",
            sandbox=self._sandbox,
        )

    def _is_session_ready(self, session):  # noqa: ANN001
        return self.ready


def test_open_session_reuses_existing_runtime_session_with_new_folder_query():
    sandbox = _FakeSandbox("/openagents/threads/thread-1/user-data")
    manager = _TestManager(sandbox=sandbox)

    first = manager.open_session(thread_id="thread-1", target_path="/mnt/user-data/workspace")
    second = manager.open_session(thread_id="thread-1", target_path="/mnt/user-data/outputs")

    assert first.session_id == second.session_id
    assert first.public_base_path == second.public_base_path
    assert "folder=%2Fmnt%2Fuser-data%2Fworkspace" in first.relative_url
    assert "folder=%2Fmnt%2Fuser-data%2Foutputs" in second.relative_url
    assert len(sandbox.launch_calls) == 1
    assert sandbox.launch_calls[0]["public_base_path"] == first.public_base_path


def test_open_session_rebases_authoring_targets_inside_visible_root():
    sandbox = _FakeSandbox("/openagents/threads/thread-2/user-data")
    manager = _TestManager(sandbox=sandbox)

    session = manager.open_session(
        thread_id="thread-2",
        mode=ide_sessions_module.AUTHORING_IDE_MODE,
        target_path="/mnt/user-data/authoring/skills/checklists",
    )

    assert "folder=%2Fmnt%2Fuser-data%2Fskills%2Fchecklists" in session.relative_url
    assert sandbox.launch_calls[0]["bind_source"] == "/openagents/threads/thread-2/user-data/authoring"


def test_open_session_rejects_targets_outside_authoring_root():
    sandbox = _FakeSandbox("/openagents/threads/thread-3/user-data")
    manager = _TestManager(sandbox=sandbox)

    with pytest.raises(ide_sessions_module.SandboxIDEAccessDeniedError):
        manager.open_session(
            thread_id="thread-3",
            mode=ide_sessions_module.AUTHORING_IDE_MODE,
            target_path="/mnt/user-data/workspace",
        )


def test_expired_session_is_terminated_and_recreated(monkeypatch: pytest.MonkeyPatch):
    now = {"value": 100.0}
    monkeypatch.setattr(ide_sessions_module.time, "time", lambda: now["value"])

    sandbox = _FakeSandbox("/openagents/threads/thread-4/user-data")
    manager = _TestManager(sandbox=sandbox, ttl_seconds=10)

    first = manager.open_session(thread_id="thread-4")
    now["value"] = 200.0
    second = manager.open_session(thread_id="thread-4")

    assert first.session_id != second.session_id
    assert sandbox.terminated_pids == [4242]
    assert len(sandbox.launch_calls) == 2


def test_resolve_proxy_target_rejects_wrong_owner():
    sandbox = _FakeSandbox("/openagents/threads/thread-5/user-data")
    manager = _TestManager(sandbox=sandbox)
    session = manager.open_session(thread_id="thread-5", user_id="owner-1")

    with pytest.raises(ide_sessions_module.SandboxIDEAccessDeniedError):
        manager.resolve_proxy_target(
            session_id=session.session_id,
            access_token=session.access_token,
            user_id="owner-2",
        )
