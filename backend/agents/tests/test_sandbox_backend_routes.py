from deepagents.backends import CompositeBackend, FilesystemBackend

from src.runtime_backends import sandbox as sandbox_module


class _DummyProvider:
    def __init__(self, backend):
        self._backend = backend

    def acquire(self, thread_id: str) -> str:
        assert thread_id == "thread-1"
        return "sandbox-1"

    def get(self, sandbox_id: str):
        assert sandbox_id == "sandbox-1"
        return self._backend


def test_build_sandbox_workspace_backend_routes_archived_skills_read_only(monkeypatch, tmp_path):
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()

    skills_root = tmp_path / "skills"
    skill_dir = skills_root / "store" / "dev" / "contract-review"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: contract-review\ndescription: sandbox route test\n---\n",
        encoding="utf-8",
    )

    dummy_backend = FilesystemBackend(root_dir=runtime_root, virtual_mode=True)
    monkeypatch.setattr(sandbox_module, "resolve_sandbox_provider", lambda: "dummy-provider")
    monkeypatch.setattr(
        sandbox_module,
        "get_sandbox_provider",
        lambda provider_path: _DummyProvider(dummy_backend),
    )

    backend = sandbox_module.build_sandbox_workspace_backend(
        "thread-1",
        skills_mount=(str(skills_root), "/mnt/skills/"),
    )

    assert isinstance(backend, CompositeBackend)

    result = backend.download_files(["/mnt/skills/store/dev/contract-review/SKILL.md"])[0]
    assert result.error is None
    assert result.content is not None
    assert b"sandbox route test" in result.content

    write_result = backend.write("/mnt/skills/store/dev/contract-review/SKILL.md", "mutate")
    assert write_result.error is not None
    assert "read-only" in write_result.error


def test_build_sandbox_workspace_backend_routes_shared_tmp(monkeypatch, tmp_path):
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    shared_tmp_root = tmp_path / "runtime-shared-tmp"
    shared_tmp_root.mkdir()

    dummy_backend = FilesystemBackend(root_dir=runtime_root, virtual_mode=True)
    monkeypatch.setattr(sandbox_module, "resolve_sandbox_provider", lambda: "dummy-provider")
    monkeypatch.setattr(
        sandbox_module,
        "get_sandbox_provider",
        lambda provider_path: _DummyProvider(dummy_backend),
    )

    backend = sandbox_module.build_sandbox_workspace_backend(
        "thread-1",
        user_data_dir=str(runtime_root),
        shared_tmp_dir=str(shared_tmp_root),
    )

    write_result = backend.write("/mnt/user-data/tmp/shared.txt", "shared tmp payload")

    assert write_result.error is None
    assert (shared_tmp_root / "shared.txt").read_text(encoding="utf-8") == "shared tmp payload"
