"""Upload router for handling file uploads."""

import logging
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from src.config.paths import get_paths
from src.gateway.uploads_utils import (
    CONVERTIBLE_EXTENSIONS as UPLOAD_CONVERTIBLE_EXTENSIONS,
    attach_markdown_metadata,
    convert_file_to_markdown,
    find_markdown_companion,
    is_convertible_upload,
    markdown_companion_name,
    upload_artifact_url,
    upload_virtual_path,
    visible_upload_paths,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threads/{thread_id}/uploads", tags=["uploads"])
CONVERTIBLE_EXTENSIONS = UPLOAD_CONVERTIBLE_EXTENSIONS


class UploadResponse(BaseModel):
    """Response model for file upload."""

    success: bool
    files: list[dict[str, str]]
    message: str


def _coerce_header_user_id(value: object) -> str | None:
    """Treat FastAPI's Header default sentinel as absent during direct unit calls."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def get_uploads_dir(thread_id: str, *, user_id: str | None = None) -> Path:
    """Get the uploads directory for a thread.

    Args:
        thread_id: The thread ID.

    Returns:
        Path to the uploads directory.
    """
    base_dir = get_paths().sandbox_uploads_dir(thread_id, user_id=user_id)
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


@router.post("", response_model=UploadResponse)
async def upload_files(
    thread_id: str,
    files: list[UploadFile] = File(...),
    x_user_id: str | None = Header(default=None, alias="x-user-id"),
) -> UploadResponse:
    """Upload multiple files to a thread's uploads directory.

    For PDF, PPT, Excel, and Word files, they will be converted to markdown using markitdown.
    All files (original and converted) are saved to /mnt/user-data/uploads.

    Args:
        thread_id: The thread ID to upload files to.
        files: List of files to upload.

    Returns:
        Upload response with success status and file information.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    owner_user_id = _coerce_header_user_id(x_user_id)
    uploads_dir = get_uploads_dir(thread_id, user_id=owner_user_id)
    uploaded_files = []

    for file in files:
        if not file.filename:
            continue

        try:
            # Normalize filename to prevent path traversal
            safe_filename = Path(file.filename).name
            if not safe_filename or safe_filename in {".", ".."} or "/" in safe_filename or "\\" in safe_filename:
                logger.warning(f"Skipping file with unsafe filename: {file.filename!r}")
                continue

            content = await file.read()
            file_path = uploads_dir / safe_filename
            file_path.write_bytes(content)

            # Build relative path from backend root
            relative_path = str(uploads_dir / safe_filename)
            file_info = {
                "filename": safe_filename,
                "size": str(len(content)),
                "path": relative_path,  # Actual filesystem path (relative to backend/)
                "virtual_path": upload_virtual_path(safe_filename),  # Path for Agent in sandbox
                "artifact_url": upload_artifact_url(thread_id, safe_filename),  # HTTP URL
            }

            logger.info("Saved file: %s (%d bytes) to %s", safe_filename, len(content), relative_path)

            # Check if file should be converted to markdown
            if is_convertible_upload(safe_filename):
                md_path = await convert_file_to_markdown(file_path)
                if md_path:
                    file_info["markdown_path"] = str(uploads_dir / md_path.name)
                    attach_markdown_metadata(file_info, thread_id=thread_id, markdown_filename=md_path.name)

            uploaded_files.append(file_info)

        except Exception as e:
            logger.error("Failed to upload %s: %s", file.filename, e)
            raise HTTPException(status_code=500, detail=f"Failed to upload {file.filename}: {str(e)}")

    return UploadResponse(
        success=True,
        files=uploaded_files,
        message=f"Successfully uploaded {len(uploaded_files)} file(s)",
    )


@router.get("/list", response_model=dict)
async def list_uploaded_files(
    thread_id: str,
    x_user_id: str | None = Header(default=None, alias="x-user-id"),
) -> dict:
    """List all files in a thread's uploads directory.

    Args:
        thread_id: The thread ID to list files for.

    Returns:
        Dictionary containing list of files with their metadata.
    """
    owner_user_id = _coerce_header_user_id(x_user_id)
    uploads_dir = get_uploads_dir(thread_id, user_id=owner_user_id)

    if not uploads_dir.exists():
        return {"files": [], "count": 0}

    files = []
    visible_paths = visible_upload_paths(uploads_dir)
    available_filenames = {file_path.name for file_path in uploads_dir.iterdir() if file_path.is_file()}
    for file_path in visible_paths:
        stat = file_path.stat()
        relative_path = str(uploads_dir / file_path.name)
        file_info = {
            "filename": file_path.name,
            "size": stat.st_size,
            "path": relative_path,  # Actual filesystem path
            "virtual_path": upload_virtual_path(file_path.name),  # Path for Agent in sandbox
            "artifact_url": upload_artifact_url(thread_id, file_path.name),  # HTTP URL
            "extension": file_path.suffix,
            "modified": stat.st_mtime,
        }
        markdown_filename = find_markdown_companion(file_path.name, available_filenames)
        if markdown_filename:
            file_info["markdown_path"] = str(uploads_dir / markdown_filename)
            attach_markdown_metadata(file_info, thread_id=thread_id, markdown_filename=markdown_filename)
        files.append(file_info)

    return {"files": files, "count": len(files)}


@router.delete("/{filename}")
async def delete_uploaded_file(
    thread_id: str,
    filename: str,
    x_user_id: str | None = Header(default=None, alias="x-user-id"),
) -> dict:
    """Delete a file from a thread's uploads directory.

    Args:
        thread_id: The thread ID.
        filename: The filename to delete.

    Returns:
        Success message.
    """
    owner_user_id = _coerce_header_user_id(x_user_id)
    uploads_dir = get_uploads_dir(thread_id, user_id=owner_user_id)
    file_path = uploads_dir / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    # Security check: ensure the path is within the uploads directory
    try:
        file_path.resolve().relative_to(uploads_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        file_path.unlink()
        if is_convertible_upload(filename):
            companion_path = uploads_dir / markdown_companion_name(filename)
            if companion_path.exists():
                companion_path.unlink()
        logger.info("Deleted file: %s", filename)
        return {"success": True, "message": f"Deleted {filename}"}
    except Exception as e:
        logger.error("Failed to delete %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"Failed to delete {filename}: {str(e)}")
