"""Shared helpers for upload storage metadata and Markdown companions."""

import logging
from pathlib import Path

from src.config.paths import VIRTUAL_PATH_PREFIX

logger = logging.getLogger(__name__)

CONVERTIBLE_EXTENSIONS = {
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
}


def is_convertible_upload(filename: str) -> bool:
    """Return whether an uploaded file should get a Markdown companion."""
    return Path(filename).suffix.lower() in CONVERTIBLE_EXTENSIONS


def markdown_companion_name(filename: str) -> str:
    """Return the generated Markdown companion filename for an upload."""
    return Path(filename).with_suffix(".md").name


def upload_virtual_path(filename: str) -> str:
    """Return the runtime-visible upload path."""
    return f"{VIRTUAL_PATH_PREFIX}/uploads/{filename}"


def upload_artifact_url(thread_id: str, filename: str) -> str:
    """Return the artifact URL for an uploaded file."""
    return f"/api/threads/{thread_id}/artifacts/mnt/user-data/uploads/{filename}"


def attach_markdown_metadata(file_info: dict, *, thread_id: str, markdown_filename: str) -> None:
    """Mutate upload metadata with Markdown companion fields."""
    file_info["markdown_file"] = markdown_filename
    file_info["markdown_virtual_path"] = upload_virtual_path(markdown_filename)
    file_info["markdown_artifact_url"] = upload_artifact_url(thread_id, markdown_filename)


def find_markdown_companion(filename: str, available_filenames: set[str]) -> str | None:
    """Return the Markdown companion filename when it exists."""
    if not is_convertible_upload(filename):
        return None

    companion = markdown_companion_name(filename)
    if companion in available_filenames:
        return companion
    return None


def original_upload_name_for_markdown(markdown_filename: str, available_filenames: set[str]) -> str | None:
    """Return the original upload filename for a generated Markdown companion."""
    stem = Path(markdown_filename).stem
    for extension in CONVERTIBLE_EXTENSIONS:
        candidate = f"{stem}{extension}"
        if candidate in available_filenames:
            return candidate
    return None


def visible_upload_paths(uploads_dir: Path) -> list[Path]:
    """List uploads while hiding generated Markdown companions from top-level listings."""
    file_paths = {
        file_path.name: file_path
        for file_path in sorted(uploads_dir.iterdir())
        if file_path.is_file()
    }
    available_filenames = set(file_paths)

    visible_paths: list[Path] = []
    for filename, file_path in file_paths.items():
        if file_path.suffix.lower() == ".md" and original_upload_name_for_markdown(filename, available_filenames):
            continue
        visible_paths.append(file_path)

    return visible_paths


async def convert_file_to_markdown(file_path: Path) -> Path | None:
    """Convert a file to Markdown using markitdown."""
    try:
        from markitdown import MarkItDown

        md = MarkItDown()
        result = md.convert(str(file_path))

        md_path = file_path.with_suffix(".md")
        md_path.write_text(result.text_content, encoding="utf-8")

        logger.info("Converted %s to markdown: %s", file_path.name, md_path.name)
        return md_path
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to convert %s to markdown: %s", file_path.name, exc)
        return None
