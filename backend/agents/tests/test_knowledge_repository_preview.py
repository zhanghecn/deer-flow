from pathlib import Path
import sys
import types

from src.knowledge.models import KnowledgeDocumentRecord

try:
    import pymupdf as _pymupdf  # noqa: F401
except ImportError:
    sys.modules.setdefault("pymupdf", types.SimpleNamespace())

from src.knowledge.repository import KnowledgeRepository, _effective_root_tree_depth


class _FakeDBStore:
    def connection(self):
        raise AssertionError("Database access is not expected in preview materialization tests")


class _FakePaths:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir

    def sandbox_outputs_dir(self, thread_id: str) -> Path:
        return self.base_dir / "threads" / thread_id / "user-data" / "outputs"


def _document(
    *,
    locator_type: str,
    source_storage_path: str,
    markdown_storage_path: str | None = None,
    preview_storage_path: str | None = None,
    canonical_storage_path: str | None = None,
) -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(
        id="doc-1",
        knowledge_base_id="kb-1",
        knowledge_base_name="Knowledge",
        knowledge_base_description=None,
        display_name="demo",
        file_kind="docx" if locator_type == "heading" else "pdf",
        locator_type=locator_type,
        status="ready",
        doc_description=None,
        error=None,
        page_count=12 if locator_type == "page" else None,
        node_count=8,
        source_storage_path=source_storage_path,
        markdown_storage_path=markdown_storage_path,
        preview_storage_path=preview_storage_path,
        canonical_storage_path=canonical_storage_path,
    )


def test_materialize_document_preview_prefers_canonical_markdown_for_heading_docs(
    monkeypatch,
    tmp_path: Path,
):
    base_dir = tmp_path / "knowledge-root"
    canonical_path = base_dir / "knowledge" / "doc-1" / "canonical.md"
    canonical_path.parent.mkdir(parents=True, exist_ok=True)
    canonical_path.write_text("# Canonical\n", encoding="utf-8")

    source_path = base_dir / "knowledge" / "doc-1" / "original.docx"
    source_path.write_bytes(b"fake-docx")

    monkeypatch.setattr("src.knowledge.repository.get_runtime_db_store", lambda: _FakeDBStore())
    monkeypatch.setattr("src.knowledge.repository.get_paths", lambda: _FakePaths(base_dir))

    repository = KnowledgeRepository()
    preview_path = repository.materialize_document_preview(
        thread_id="thread-1",
        document=_document(
            locator_type="heading",
            source_storage_path="knowledge/doc-1/original.docx",
            canonical_storage_path="knowledge/doc-1/canonical.md",
        ),
    )

    assert preview_path == "/mnt/user-data/outputs/.knowledge/doc-1/canonical.md"
    materialized_path = (
        base_dir
        / "threads"
        / "thread-1"
        / "user-data"
        / "outputs"
        / ".knowledge"
        / "doc-1"
        / "canonical.md"
    )
    assert materialized_path.read_text(encoding="utf-8") == "# Canonical\n"


def test_materialize_document_preview_prefers_pdf_preview_for_page_docs(
    monkeypatch,
    tmp_path: Path,
):
    base_dir = tmp_path / "knowledge-root"
    preview_path = base_dir / "knowledge" / "doc-1" / "preview.pdf"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.write_bytes(b"%PDF-1.4")

    monkeypatch.setattr("src.knowledge.repository.get_runtime_db_store", lambda: _FakeDBStore())
    monkeypatch.setattr("src.knowledge.repository.get_paths", lambda: _FakePaths(base_dir))

    repository = KnowledgeRepository()
    materialized_virtual_path = repository.materialize_document_preview(
        thread_id="thread-1",
        document=_document(
            locator_type="page",
            source_storage_path="knowledge/doc-1/original.pdf",
            preview_storage_path="knowledge/doc-1/preview.pdf",
            canonical_storage_path="knowledge/doc-1/canonical.md",
        ),
    )

    assert materialized_virtual_path == "/mnt/user-data/outputs/.knowledge/doc-1/preview.pdf"


def test_effective_root_tree_depth_collapses_large_root_windows():
    structure = [
        {
            "node_id": f"{index:04d}",
            "title": f"Section {index}",
            "nodes": [
                {"node_id": f"{index:04d}-a", "title": f"Section {index}.A"},
                {"node_id": f"{index:04d}-b", "title": f"Section {index}.B"},
                {"node_id": f"{index:04d}-c", "title": f"Section {index}.C"},
            ],
        }
        for index in range(1, 20)
    ]

    assert _effective_root_tree_depth(structure, requested_depth=2) == 1
    assert _effective_root_tree_depth(structure[:4], requested_depth=2) == 2


def test_rewrite_markdown_image_paths_uses_persistent_knowledge_virtual_paths(
    monkeypatch,
    tmp_path: Path,
):
    base_dir = tmp_path / "knowledge-root"
    canonical_path = base_dir / "knowledge" / "doc-1" / "canonical" / "canonical.md"
    asset_path = base_dir / "knowledge" / "doc-1" / "preview.assets" / "img-p0001-01.png"
    canonical_path.parent.mkdir(parents=True, exist_ok=True)
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    canonical_path.write_text("# Canonical\n", encoding="utf-8")
    asset_path.write_bytes(b"fake-image")

    monkeypatch.setattr("src.knowledge.repository.get_runtime_db_store", lambda: _FakeDBStore())
    monkeypatch.setattr("src.knowledge.repository.get_paths", lambda: _FakePaths(base_dir))

    repository = KnowledgeRepository()
    rewritten, image_paths = repository._rewrite_markdown_image_paths(
        thread_id="thread-1",
        document=_document(
            locator_type="heading",
            source_storage_path="knowledge/doc-1/source/original.docx",
            canonical_storage_path="knowledge/doc-1/canonical/canonical.md",
        ),
        text="![img-p0001-01](../preview.assets/img-p0001-01.png)",
    )

    expected_path = "/mnt/user-data/outputs/.knowledge/doc-1/preview.assets/img-p0001-01.png"
    assert rewritten == f"![img-p0001-01]({expected_path})"
    assert image_paths == [expected_path]


class _FakePixmap:
    def __init__(self, page_number: int) -> None:
        self._page_number = page_number

    def save(self, target_path: Path) -> None:
        target_path.write_bytes(f"page-{self._page_number}".encode("utf-8"))


class _FakePage:
    def __init__(self, page_number: int) -> None:
        self._page_number = page_number

    def get_images(self, *, full: bool) -> list[tuple[int]]:
        assert full is True
        return [(1,), (2,)]

    def get_pixmap(self, *, matrix, alpha: bool) -> _FakePixmap:
        assert alpha is False
        return _FakePixmap(self._page_number)


class _FakePDF:
    page_count = 12

    def load_page(self, index: int) -> _FakePage:
        return _FakePage(index + 1)

    def close(self) -> None:
        return None


def test_ensure_document_page_asset_persists_under_document_package_root(
    monkeypatch,
    tmp_path: Path,
):
    base_dir = tmp_path / "knowledge-root"
    preview_path = base_dir / "knowledge" / "doc-1" / "preview" / "preview.pdf"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.write_bytes(b"%PDF-1.4")

    monkeypatch.setattr("src.knowledge.repository.get_runtime_db_store", lambda: _FakeDBStore())
    monkeypatch.setattr("src.knowledge.repository.get_paths", lambda: _FakePaths(base_dir))
    monkeypatch.setattr("src.knowledge.repository.pymupdf.open", lambda path: _FakePDF(), raising=False)
    monkeypatch.setattr("src.knowledge.repository.pymupdf.Matrix", lambda x, y: (x, y), raising=False)

    repository = KnowledgeRepository()
    virtual_path, embedded_image_count = repository.ensure_document_page_asset(
        document=_document(
            locator_type="page",
            source_storage_path="knowledge/doc-1/source/original.pdf",
            preview_storage_path="knowledge/doc-1/preview/preview.pdf",
            canonical_storage_path="knowledge/doc-1/canonical/canonical.md",
        ),
        page_number=12,
    )

    assert virtual_path == "/mnt/user-data/outputs/.knowledge/doc-1/assets/pages/page-0012.png"
    assert embedded_image_count == 2
    persisted_path = base_dir / "knowledge" / "doc-1" / "assets" / "pages" / "page-0012.png"
    assert persisted_path.read_bytes() == b"page-12"
