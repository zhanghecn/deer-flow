import base64
import mimetypes
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.config.paths import get_paths
from src.runtime_backends import build_runtime_workspace_backend
from src.utils.runtime_context import runtime_context_value


def _runtime_thread_id(runtime: ToolRuntime[ContextT, ThreadState] | None) -> str:
    context = getattr(runtime, "context", None)
    thread_id = runtime_context_value(context, "thread_id") or runtime_context_value(context, "x-thread-id")
    if not thread_id:
        raise ValueError("thread_id is required in runtime context.")
    return str(thread_id)


@tool("view_image", parse_docstring=True)
def view_image_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    image_path: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Read an image file.

    Use this tool to read an image file and make it available for display.

    When to use the view_image tool:
    - When you need to view an image file.

    When NOT to use the view_image tool:
    - For non-image files (use present_files instead)
    - For multiple files at once (use present_files instead)

    Args:
        image_path: Absolute path to the image file. Common formats supported: jpg, jpeg, png, webp.
    """
    # Validate that the path is absolute
    normalized_path = str(image_path).strip()
    if not normalized_path.startswith("/"):
        return Command(
            update={"messages": [ToolMessage(f"Error: Path must be absolute, got: {image_path}", tool_call_id=tool_call_id)]},
        )

    thread_id = _runtime_thread_id(runtime)
    paths = get_paths()
    execution_backend = runtime_context_value(getattr(runtime, "context", None), "execution_backend")
    remote_session_id = runtime_context_value(getattr(runtime, "context", None), "remote_session_id")
    backend = build_runtime_workspace_backend(
        user_data_dir=str(paths.sandbox_user_data_dir(thread_id)),
        thread_id=thread_id,
        paths=paths,
        requested_backend=execution_backend,
        remote_session_id=remote_session_id,
    )
    download_result = backend.download_files([normalized_path])[0]

    if download_result.error == "file_not_found":
        return Command(
            update={"messages": [ToolMessage(f"Error: Image file not found: {image_path}", tool_call_id=tool_call_id)]},
        )
    if download_result.error == "is_directory":
        return Command(
            update={"messages": [ToolMessage(f"Error: Path is not a file: {image_path}", tool_call_id=tool_call_id)]},
        )
    if download_result.error == "permission_denied":
        return Command(
            update={"messages": [ToolMessage(f"Error: Permission denied reading image file: {image_path}", tool_call_id=tool_call_id)]},
        )
    if download_result.error == "invalid_path":
        return Command(
            update={"messages": [ToolMessage(f"Error: Invalid image path: {image_path}", tool_call_id=tool_call_id)]},
        )
    if download_result.content is None:
        return Command(
            update={"messages": [ToolMessage(f"Error reading image file: {image_path}", tool_call_id=tool_call_id)]},
        )

    # Validate image extension
    valid_extensions = {".jpg", ".jpeg", ".png", ".webp"}
    suffix = normalized_path.rsplit(".", 1)[-1].lower() if "." in normalized_path else ""
    normalized_suffix = f".{suffix}" if suffix else ""
    if normalized_suffix not in valid_extensions:
        return Command(
            update={"messages": [ToolMessage(f"Error: Unsupported image format: {normalized_suffix}. Supported formats: {', '.join(valid_extensions)}", tool_call_id=tool_call_id)]},
        )

    # Detect MIME type from file extension
    mime_type, _ = mimetypes.guess_type(normalized_path)
    if mime_type is None:
        extension_to_mime = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }
        mime_type = extension_to_mime.get(normalized_suffix, "application/octet-stream")

    image_base64 = base64.b64encode(download_result.content).decode("utf-8")

    # Update viewed_images in state
    new_viewed_images = {normalized_path: {"base64": image_base64, "mime_type": mime_type}}

    return Command(
        update={"viewed_images": new_viewed_images, "messages": [ToolMessage("Successfully read image", tool_call_id=tool_call_id)]},
    )
