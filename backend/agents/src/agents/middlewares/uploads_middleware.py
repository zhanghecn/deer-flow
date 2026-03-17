"""Middleware to inject uploaded files information into agent context."""

import logging
from pathlib import Path
from typing import NotRequired, override

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


def _is_safe_upload_filename(filename: str) -> bool:
    return bool(filename) and Path(filename).name == filename


def _virtual_upload_path(filename: str) -> str:
    return f"/mnt/user-data/uploads/{filename}"


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

    def __init__(self, base_dir: str | None = None):
        """Initialize the middleware.

        Args:
            base_dir: Base directory for thread data. Defaults to Paths resolution.
        """
        super().__init__()
        self._paths = Paths(base_dir) if base_dir else get_paths()

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
        size_kb = file["size"] / 1024
        size_str = f"{size_kb:.1f} KB" if size_kb < 1024 else f"{size_kb / 1024:.1f} MB"
        preferred_path = file.get("markdown_path") or file["path"]

        lines.append(f"- {file['filename']} ({size_str})")
        lines.append(f"  Path: {preferred_path}")

        original_path = file["path"]
        if preferred_path != original_path:
            lines.append(f"  Original Path: {original_path}")
            lines.append("  Note: `Path` is the converted Markdown companion. Read it first.")

        lines.append("")

    def _create_files_message(self, new_files: list[dict], historical_files: list[dict]) -> str:
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
            "Use the `read_file` tool with the `Path` shown above. When `Original Path` is also present, `Path` is the generated Markdown companion and should be read first."
        )
        lines.append("</uploaded_files>")

        return "\n".join(lines)

    def _files_from_kwargs(self, message: HumanMessage, uploads_dir: Path | None = None) -> list[dict] | None:
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
        for f in kwargs_files:
            if not isinstance(f, dict):
                continue
            filename = f.get("filename") or ""
            if not _is_safe_upload_filename(filename):
                continue
            if uploads_dir is not None and not (uploads_dir / filename).is_file():
                continue
            markdown_filename = f.get("markdown_file")
            if not isinstance(markdown_filename, str):
                markdown_virtual_path = f.get("markdown_virtual_path")
                if isinstance(markdown_virtual_path, str):
                    markdown_filename = Path(markdown_virtual_path).name

            file_record = self._build_file_record(
                filename=filename,
                size=int(f.get("size") or 0),
                uploads_dir=uploads_dir,
                candidate_markdown_filename=markdown_filename,
            )
            if file_record is None:
                continue
            files.append(file_record)
        return files if files else None

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
        excluded_filenames = {f["filename"] for f in new_files}
        excluded_filenames.update(
            str(f["markdown_file"])
            for f in new_files
            if isinstance(f.get("markdown_file"), str)
        )
        historical_files: list[dict] = []
        if uploads_dir and uploads_dir.exists():
            file_paths = {
                file_path.name: file_path
                for file_path in sorted(uploads_dir.iterdir())
                if file_path.is_file()
            }
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

        logger.debug(f"New files: {[f['filename'] for f in new_files]}, historical: {[f['filename'] for f in historical_files]}")

        # Create files message and prepend to the last human message content
        files_message = self._create_files_message(new_files, historical_files)

        # Extract original content - handle both string and list formats
        original_content = ""
        if isinstance(last_message.content, str):
            original_content = last_message.content
        elif isinstance(last_message.content, list):
            text_parts = []
            for block in last_message.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
            original_content = "\n".join(text_parts)

        # Create new message with combined content.
        # Preserve additional_kwargs (including files metadata) so the frontend
        # can read structured file info from the streamed message.
        updated_message = HumanMessage(
            content=f"{files_message}\n\n{original_content}",
            id=last_message.id,
            additional_kwargs=last_message.additional_kwargs,
        )

        messages[last_message_index] = updated_message

        return {
            "uploaded_files": new_files,
            "messages": messages,
        }
