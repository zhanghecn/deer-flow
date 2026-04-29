"""Middleware to inject uploaded files information into agent context."""

import base64
import logging
import mimetypes
from pathlib import Path
from typing import NotRequired, override

from deepagents.middleware.image_utils import (
    PreparedModelImage,
    prepare_image_bytes_for_model,
)
from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime

from src.config.paths import Paths, get_paths

logger = logging.getLogger(__name__)

MARKDOWN_COMPANION_EXTENSIONS = (
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
)
IMAGE_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
IMAGE_UPLOAD_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
UPLOAD_IMAGE_INLINE_LIMIT = 4


def _is_safe_upload_filename(filename: str) -> bool:
    return bool(filename) and Path(filename).name == filename


def _virtual_upload_path(filename: str) -> str:
    return f"/mnt/user-data/uploads/{filename}"


def _format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def _mime_type_for_upload(filename: str, provided: str | None = None) -> str:
    normalized = (provided or "").strip().lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    if normalized:
        return normalized
    return (mimetypes.guess_type(filename)[0] or "application/octet-stream").lower()


def _is_image_upload(upload: dict) -> bool:
    filename = str(upload.get("filename") or "")
    mime_type = _mime_type_for_upload(filename, upload.get("mime_type"))
    extension = str(upload.get("extension") or Path(filename).suffix).lower()
    return mime_type in IMAGE_UPLOAD_MIME_TYPES or extension in IMAGE_UPLOAD_EXTENSIONS


def _uploaded_mime_type(upload: dict, filename: str) -> str | None:
    raw_mime_type = upload.get("mime_type")
    if not isinstance(raw_mime_type, str):
        raw_mime_type = upload.get("mimeType")
    if not isinstance(raw_mime_type, str):
        return None
    return _mime_type_for_upload(filename, raw_mime_type)


def _existing_upload_files(uploads_dir: Path) -> dict[str, Path]:
    """Return only regular files from the thread uploads directory."""
    files: dict[str, Path] = {}
    for file_path in sorted(uploads_dir.iterdir()):
        if file_path.is_file():
            files[file_path.name] = file_path
    return files


def _excluded_filenames_for_current_uploads(new_files: list[dict]) -> set[str]:
    filenames: set[str] = set()
    for upload in new_files:
        filenames.add(str(upload["filename"]))
        markdown_filename = upload.get("markdown_file")
        if isinstance(markdown_filename, str):
            filenames.add(markdown_filename)
    return filenames


def _prepare_upload_image_for_model(
    image_path: Path,
    mime_type: str,
) -> PreparedModelImage | None:
    """Downsample one uploaded image using the same path as `read_file` images."""

    return prepare_image_bytes_for_model(
        image_path.read_bytes(),
        mime_type,
        source_name=str(image_path),
    )


def _format_model_image_detail(
    *,
    filename: str,
    prepared: PreparedModelImage,
    original_bytes: int,
) -> str:
    """Describe image preparation without repeating base64 in prompts or traces."""

    prepared_bytes = prepared.prepared_bytes or len(prepared.data)
    detail = f"{filename} ({prepared.mime_type}, {_format_bytes(original_bytes)}"
    if prepared_bytes != original_bytes:
        detail += f" -> {_format_bytes(prepared_bytes)}"
    if prepared.display_width and prepared.display_height:
        detail += f", {prepared.display_width}x{prepared.display_height}"
    return f"{detail})"


class UploadsMiddlewareState(AgentState):
    """State schema for uploads middleware."""

    uploaded_files: NotRequired[list[dict] | None]


class UploadsMiddleware(AgentMiddleware[UploadsMiddlewareState]):
    """Middleware to inject uploaded files information into the agent context.

    Reads file metadata from the current message's additional_kwargs.files
    (set by the frontend after upload) and prepends an <uploaded_files> block
    to the last human message so the model knows which files are available.
    """

    state_schema = UploadsMiddlewareState

    def __init__(
        self,
        base_dir: str | None = None,
        *,
        model_supports_vision: bool = False,
    ):
        """Initialize the middleware.

        Args:
            base_dir: Base directory for thread data. Defaults to Paths resolution.
            model_supports_vision: Whether current model can accept image blocks.
        """
        super().__init__()
        self._paths = Paths(base_dir) if base_dir else get_paths()
        self._model_supports_vision = model_supports_vision

    def _resolve_markdown_filename(
        self,
        *,
        filename: str,
        uploads_dir: Path | None = None,
        candidate_markdown_filename: str | None = None,
    ) -> str | None:
        """Resolve the generated Markdown companion filename for a convertible upload."""
        if Path(filename).suffix.lower() not in MARKDOWN_COMPANION_EXTENSIONS:
            return None

        if candidate_markdown_filename and _is_safe_upload_filename(candidate_markdown_filename):
            if uploads_dir is None or (uploads_dir / candidate_markdown_filename).is_file():
                return candidate_markdown_filename

        if uploads_dir is None:
            return None

        markdown_filename = Path(filename).with_suffix(".md").name
        if (uploads_dir / markdown_filename).is_file():
            return markdown_filename

        return None

    def _build_file_record(
        self,
        *,
        filename: str,
        size: int,
        uploads_dir: Path | None = None,
        candidate_markdown_filename: str | None = None,
    ) -> dict | None:
        """Build the normalized uploaded-file metadata exposed to the model."""
        if not _is_safe_upload_filename(filename):
            return None

        file_record = {
            "filename": filename,
            "size": size,
            "path": _virtual_upload_path(filename),
            "extension": Path(filename).suffix.lower(),
        }

        markdown_filename = self._resolve_markdown_filename(
            filename=filename,
            uploads_dir=uploads_dir,
            candidate_markdown_filename=candidate_markdown_filename,
        )
        if markdown_filename:
            file_record["markdown_file"] = markdown_filename
            file_record["markdown_path"] = _virtual_upload_path(markdown_filename)

        return file_record

    def _find_original_for_markdown(
        self,
        markdown_filename: str,
        available_filenames: set[str],
    ) -> str | None:
        """Return the original convertible filename for a generated markdown companion."""
        stem = Path(markdown_filename).stem
        for extension in MARKDOWN_COMPANION_EXTENSIONS:
            candidate = f"{stem}{extension}"
            if candidate in available_filenames:
                return candidate
        return None

    def _append_file_lines(self, lines: list[str], file: dict) -> None:
        """Append one uploaded file entry to the injected context block."""
        preferred_path = file.get("markdown_path") or file["path"]

        lines.append(f"- {file['filename']} ({_format_bytes(file['size'])})")
        lines.append(f"  Path: {preferred_path}")

        original_path = file["path"]
        if preferred_path != original_path:
            lines.append(f"  Original Path: {original_path}")
            lines.append("  Note: `Path` is the converted Markdown companion. Read it first.")
        elif _is_image_upload(file):
            lines.append("  Note: image content is attached inline for vision-capable models.")

        lines.append("")

    def _create_files_message(
        self,
        new_files: list[dict],
        historical_files: list[dict],
    ) -> str:
        """Create a formatted message listing uploaded files.

        Args:
            new_files: Files uploaded in the current message.
            historical_files: Files uploaded in previous messages.

        Returns:
            Formatted string inside <uploaded_files> tags.
        """
        lines = ["<uploaded_files>"]

        lines.append("The following files were uploaded in this message:")
        lines.append("")
        if new_files:
            for file in new_files:
                self._append_file_lines(lines, file)
        else:
            lines.append("(empty)")

        if historical_files:
            lines.append("The following files were uploaded in previous messages and are still available:")
            lines.append("")
            for file in historical_files:
                self._append_file_lines(lines, file)

        lines.append(
            "Inspect inline image attachments directly when they are present. "
            "For non-image uploads, use the `read_file` tool with the `Path` shown above. "
            "When `Original Path` is also present, `Path` is the generated Markdown companion and should be read first."
        )
        lines.append("</uploaded_files>")

        return "\n".join(lines)

    def _files_from_kwargs(
        self,
        message: HumanMessage,
        uploads_dir: Path | None = None,
    ) -> list[dict] | None:
        """Extract file info from message additional_kwargs.files.

        The frontend sends uploaded file metadata in additional_kwargs.files
        after a successful upload. Each entry has: filename, size (bytes),
        path (virtual path), status.

        Args:
            message: The human message to inspect.
            uploads_dir: Physical uploads directory used to verify file existence.
                         When provided, entries whose files no longer exist are skipped.

        Returns:
            List of file dicts with virtual paths, or None if the field is absent or empty.
        """
        kwargs_files = (message.additional_kwargs or {}).get("files")
        if not isinstance(kwargs_files, list) or not kwargs_files:
            return None

        files = []
        for upload in kwargs_files:
            if not isinstance(upload, dict):
                continue
            filename = upload.get("filename") or ""
            if not _is_safe_upload_filename(filename):
                continue
            if uploads_dir is not None and not (uploads_dir / filename).is_file():
                continue
            mime_type = _uploaded_mime_type(upload, filename)
            markdown_filename = upload.get("markdown_file")
            if not isinstance(markdown_filename, str):
                markdown_virtual_path = upload.get("markdown_virtual_path")
                if isinstance(markdown_virtual_path, str):
                    markdown_filename = Path(markdown_virtual_path).name

            file_record = self._build_file_record(
                filename=filename,
                size=int(upload.get("size") or 0),
                uploads_dir=uploads_dir,
                candidate_markdown_filename=markdown_filename,
            )
            if file_record is None:
                continue
            if mime_type:
                file_record["mime_type"] = mime_type
            files.append(file_record)
        return files if files else None

    def _original_text_and_media_blocks(self, content: object) -> tuple[str, list[dict]]:
        """Preserve existing non-text content blocks while extracting user text."""

        if isinstance(content, str):
            return content, []
        if not isinstance(content, list):
            return str(content or ""), []

        text_parts: list[str] = []
        media_blocks: list[dict] = []
        for block in content:
            if isinstance(block, str):
                text_parts.append(block)
                continue
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text_parts.append(str(block.get("text") or ""))
            else:
                media_blocks.append(block)
        return "\n".join(part for part in text_parts if part), media_blocks

    def _image_blocks_for_new_uploads(
        self,
        *,
        new_files: list[dict],
        uploads_dir: Path | None,
    ) -> list[dict]:
        """Create model-visible image blocks for current-turn uploaded images.

        This is deliberately limited to current-turn files. Historical uploads
        remain discoverable by path, but replaying every prior image into each
        model request would make context growth unpredictable.
        """

        if not self._model_supports_vision or uploads_dir is None:
            return []

        blocks: list[dict] = []
        image_count = 0
        for upload in new_files:
            if image_count >= UPLOAD_IMAGE_INLINE_LIMIT or not _is_image_upload(upload):
                continue
            filename = str(upload.get("filename") or "")
            if not _is_safe_upload_filename(filename):
                continue
            image_path = uploads_dir / filename
            if not image_path.is_file():
                continue
            mime_type = _mime_type_for_upload(filename, upload.get("mime_type"))
            try:
                prepared = _prepare_upload_image_for_model(image_path, mime_type)
            except Exception as exc:
                logger.warning(
                    "Failed to prepare uploaded image %s for model input: %s",
                    image_path,
                    exc,
                )
                continue
            if prepared is None:
                continue

            base64_data = base64.b64encode(prepared.data).decode("ascii")
            original_bytes = int(upload.get("size") or prepared.original_bytes or 0)
            detail = _format_model_image_detail(
                filename=filename,
                prepared=prepared,
                original_bytes=original_bytes,
            )

            blocks.append(
                {
                    "type": "text",
                    "text": f"Attached uploaded image for visual inspection: {detail}",
                }
            )
            blocks.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{prepared.mime_type};base64,{base64_data}",
                    },
                }
            )
            image_count += 1
        return blocks

    def _resolve_thread_id(
        self,
        runtime: Runtime,
        config: RunnableConfig | None,
    ) -> str | None:
        runtime_context = getattr(runtime, "context", None)
        if isinstance(runtime_context, dict):
            runtime_thread_id = runtime_context.get("thread_id") or runtime_context.get("x-thread-id")
            if runtime_thread_id is not None:
                return str(runtime_thread_id)

        configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
        if isinstance(configurable, dict):
            configured_thread_id = configurable.get("thread_id") or configurable.get("x-thread-id")
            if configured_thread_id is not None:
                return str(configured_thread_id)

        return None

    @override
    def before_agent(
        self,
        state: UploadsMiddlewareState,
        runtime: Runtime,
        config: RunnableConfig | None = None,
    ) -> dict | None:  # ty: ignore[invalid-method-override]
        """Inject uploaded files information before agent execution.

        New files come from the current message's additional_kwargs.files.
        Historical files are scanned from the thread's uploads directory,
        excluding the new ones.

        Prepends <uploaded_files> context to the last human message content.
        The original additional_kwargs (including files metadata) is preserved
        on the updated message so the frontend can read it from the stream.

        Args:
            state: Current agent state.
            runtime: Runtime context containing thread_id.

        Returns:
            State updates including uploaded files list.
        """
        messages = list(state.get("messages", []))
        if not messages:
            return None

        last_message_index = len(messages) - 1
        last_message = messages[last_message_index]

        if not isinstance(last_message, HumanMessage):
            return None

        # Resolve uploads directory for existence checks
        thread_id = self._resolve_thread_id(runtime, config)
        uploads_dir = self._paths.sandbox_uploads_dir(thread_id) if thread_id else None

        # Get newly uploaded files from the current message's additional_kwargs.files
        new_files = self._files_from_kwargs(last_message, uploads_dir) or []

        # Collect historical files from the uploads directory (all except the new ones)
        excluded_filenames = _excluded_filenames_for_current_uploads(new_files)
        historical_files: list[dict] = []
        if uploads_dir and uploads_dir.exists():
            file_paths = _existing_upload_files(uploads_dir)
            available_filenames = set(file_paths)

            for filename, file_path in file_paths.items():
                if filename in excluded_filenames:
                    continue
                if file_path.suffix.lower() == ".md":
                    original_filename = self._find_original_for_markdown(filename, available_filenames)
                    if original_filename is not None:
                        continue

                file_record = self._build_file_record(
                    filename=filename,
                    size=file_path.stat().st_size,
                    uploads_dir=uploads_dir,
                )
                if file_record is not None:
                    historical_files.append(file_record)

        if not new_files and not historical_files:
            return None

        logger.debug(
            "New files: %s, historical: %s",
            [f["filename"] for f in new_files],
            [f["filename"] for f in historical_files],
        )

        # Create files message and prepend to the last human message content
        files_message = self._create_files_message(new_files, historical_files)

        original_content, original_media_blocks = self._original_text_and_media_blocks(last_message.content)
        image_blocks = self._image_blocks_for_new_uploads(
            new_files=new_files,
            uploads_dir=uploads_dir,
        )
        combined_text = f"{files_message}\n\n{original_content}"
        if original_media_blocks or image_blocks:
            updated_content: str | list[dict] = [
                {"type": "text", "text": combined_text},
                *original_media_blocks,
                *image_blocks,
            ]
        else:
            updated_content = combined_text

        # Create new message with combined content.
        # Preserve additional_kwargs (including files metadata) so the frontend
        # can read structured file info from the streamed message.
        updated_message = HumanMessage(
            content=updated_content,
            id=last_message.id,
            additional_kwargs=last_message.additional_kwargs,
        )

        messages[last_message_index] = updated_message

        return {
            "uploaded_files": new_files,
            "messages": messages,
        }
