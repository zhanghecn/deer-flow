import os
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.gateway.routers import artifacts


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(artifacts.router)
    return app


def test_office_preview_path_uses_sidecar_pdf() -> None:
    path = Path("/tmp/deck.docx")
    assert artifacts._office_preview_path(path) == Path("/tmp/deck.docx.preview.pdf")


def test_ensure_office_pdf_preview_reuses_fresh_cache(tmp_path: Path) -> None:
    source = tmp_path / "deck.xlsx"
    source.write_bytes(b"xlsx")

    preview = artifacts._office_preview_path(source)
    preview.write_bytes(b"%PDF-1.7")

    source_mtime = source.stat().st_mtime
    os.utime(preview, (source_mtime + 10, source_mtime + 10))

    with patch("src.gateway.routers.artifacts.subprocess.run") as mocked_run:
        resolved = artifacts._ensure_office_pdf_preview(source)

    assert resolved == preview
    mocked_run.assert_not_called()


def test_get_artifact_returns_pdf_preview_for_office_document(tmp_path: Path) -> None:
    deck_path = tmp_path / "market-report.docx"
    deck_path.write_bytes(b"docx-bytes")

    preview_path = artifacts._office_preview_path(deck_path)
    preview_path.write_bytes(b"%PDF-1.7 preview")

    with (
        patch("src.gateway.routers.artifacts.resolve_thread_virtual_path", return_value=deck_path),
        patch("src.gateway.routers.artifacts._ensure_office_pdf_preview", return_value=preview_path),
    ):
        with TestClient(_make_test_app()) as client:
            response = client.get(
                "/api/threads/thread-1/artifacts/mnt/user-data/outputs/market-report.docx?preview=pdf"
            )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content == b"%PDF-1.7 preview"


def test_get_artifact_decodes_url_encoded_path(tmp_path: Path) -> None:
    artifact_path = tmp_path / "A股报告.txt"
    artifact_path.write_text("ok", encoding="utf-8")

    with patch("src.gateway.routers.artifacts.resolve_thread_virtual_path", return_value=artifact_path) as mocked_resolve:
        with TestClient(_make_test_app()) as client:
            response = client.get(
                "/api/threads/thread-1/artifacts/mnt/user-data/outputs/A%E8%82%A1%E6%8A%A5%E5%91%8A.txt"
            )

    assert response.status_code == 200
    assert response.text == "ok"
    mocked_resolve.assert_called_once_with(
        "thread-1",
        "mnt/user-data/outputs/A股报告.txt",
        user_id=None,
    )
