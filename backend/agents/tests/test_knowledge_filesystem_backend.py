from __future__ import annotations

from types import SimpleNamespace

from src.knowledge.models import KnowledgeWorkspaceRecord
from src.runtime_backends.knowledge_filesystem import ThreadKnowledgeFilesystemBackend


def _workspace() -> KnowledgeWorkspaceRecord:
    return KnowledgeWorkspaceRecord(
        id="kb-1",
        owner_id="user-1",
        name="八字案例",
        description=None,
        source_type="library",
        visibility="private",
        document_count=1,
        ready_document_count=1,
    )


class _FakeKnowledgeService:
    def get_thread_workspace_records(self, *, user_id: str, thread_id: str, ready_only: bool = False):
        assert user_id == "user-1"
        assert thread_id == "thread-1"
        assert ready_only is True
        return [_workspace()]


class _FakeWorkspaceStore:
    files = {
        "raw/sources/.cache/cases.txt": "壬寅 庚戌 丁酉 壬寅\n甲辰 丙子 丁酉 乙巳\n",
        "wiki/sources/cases.md": "# cases\n\nsource summary\n",
    }

    def list_files(self, workspace: KnowledgeWorkspaceRecord, relative_prefix: str = ""):
        prefix = relative_prefix.strip("/")
        return [
            SimpleNamespace(path=path, storage_ref=path)
            for path in sorted(self.files)
            if not prefix or path.startswith(f"{prefix}/")
        ]

    def read_text(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> str:
        try:
            return self.files[relative_path]
        except KeyError as exc:
            raise FileNotFoundError(relative_path) from exc

    def storage_ref(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> str:
        return relative_path


class _FakeAssetStore:
    def read_bytes(self, storage_ref: str) -> bytes:
        return _FakeWorkspaceStore.files[storage_ref].encode("utf-8")


def _backend() -> ThreadKnowledgeFilesystemBackend:
    backend = ThreadKnowledgeFilesystemBackend(
        user_id="user-1",
        thread_id="thread-1",
        service=_FakeKnowledgeService(),
        asset_store=_FakeAssetStore(),  # type: ignore[arg-type]
    )
    backend._workspace_store = _FakeWorkspaceStore()  # noqa: SLF001 - focused fake store.
    return backend


def test_knowledge_filesystem_exposes_workspace_as_read_only_files() -> None:
    backend = _backend()

    root = backend.ls_info("/")
    assert root == [
        {
            "path": "/八字案例__kb-1/",
            "is_dir": True,
            "size": 0,
            "modified_at": "",
        }
    ]
    assert backend.glob_info("**/*.txt", "/八字案例__kb-1") == [
        {
            "path": "/八字案例__kb-1/raw/sources/.cache/cases.txt",
            "is_dir": False,
            "size": 0,
            "modified_at": "",
        }
    ]


def test_knowledge_filesystem_grep_and_read_use_exact_lines() -> None:
    backend = _backend()

    matches = backend.grep_raw("丁酉", path="/八字案例__kb-1")

    assert matches == [
        {
            "path": "/八字案例__kb-1/raw/sources/.cache/cases.txt",
            "line": 1,
            "text": "壬寅 庚戌 丁酉 壬寅",
        },
        {
            "path": "/八字案例__kb-1/raw/sources/.cache/cases.txt",
            "line": 2,
            "text": "甲辰 丙子 丁酉 乙巳",
        },
    ]

    content = backend.read("/八字案例__kb-1/raw/sources/.cache/cases.txt", offset=1, limit=1)

    assert "甲辰 丙子 丁酉 乙巳" in content
    assert "壬寅 庚戌 丁酉 壬寅" not in content


def test_knowledge_filesystem_grep_accepts_exact_file_path() -> None:
    backend = _backend()

    matches = backend.grep_raw(
        "甲辰",
        path="/八字案例__kb-1/raw/sources/.cache/cases.txt",
    )

    assert matches == [
        {
            "path": "/八字案例__kb-1/raw/sources/.cache/cases.txt",
            "line": 2,
            "text": "甲辰 丙子 丁酉 乙巳",
        }
    ]
