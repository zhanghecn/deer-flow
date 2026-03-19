from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Sequence
from pathlib import PurePosixPath
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ExtendedModelResponse, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, BaseMessage

_GENERIC_VIRTUAL_PATH_PATTERN = re.compile(
    r"/mnt/user-data/(?P<scope>outputs|uploads|workspace|authoring|agents)"
    r"(?P<tail>/[^\s`<>\"'()\[\]{}，。！？；：,]*)?"
)
_CHINESE_OUTPUT_PHRASE_PATTERN = re.compile(r"(?:已保存至|已写入到|已写入至|保存在)\s+`(?P<filename>[^`]+)`")
_ENGLISH_OUTPUT_PHRASE_PATTERN = re.compile(
    r"\b(?:saved|written)\s+to\s+`(?P<filename>[^`]+)`",
    re.IGNORECASE,
)

_SCOPE_LABELS = {
    "outputs": "output",
    "uploads": "upload",
    "workspace": "workspace",
    "authoring": "draft",
    "agents": "agent runtime",
}


def sanitize_user_visible_text(text: str, *, artifacts: Sequence[str] = ()) -> str:
    sanitized = text

    for artifact_path in _sorted_runtime_paths(artifacts):
        filename = _basename_for_runtime_path(artifact_path)
        if not filename:
            continue
        sanitized = sanitized.replace(artifact_path, f"`{filename}`")

    sanitized = _GENERIC_VIRTUAL_PATH_PATTERN.sub(_replace_generic_runtime_path, sanitized)
    sanitized = _CHINESE_OUTPUT_PHRASE_PATTERN.sub(
        lambda match: f"已作为附件提供（`{match.group('filename')}`）",
        sanitized,
    )
    sanitized = _ENGLISH_OUTPUT_PHRASE_PATTERN.sub(
        lambda match: f"attached as `{match.group('filename')}`",
        sanitized,
    )
    return sanitized


def sanitize_user_visible_content(content: Any, *, artifacts: Sequence[str] = ()) -> Any:
    if isinstance(content, str):
        return sanitize_user_visible_text(content, artifacts=artifacts)

    if not isinstance(content, list):
        return content

    changed = False
    sanitized_blocks: list[Any] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            sanitized_text = sanitize_user_visible_text(block["text"], artifacts=artifacts)
            if sanitized_text != block["text"]:
                block = {**block, "text": sanitized_text}
                changed = True
        sanitized_blocks.append(block)

    return sanitized_blocks if changed else content


def sanitize_user_visible_message(message: BaseMessage, *, artifacts: Sequence[str] = ()) -> BaseMessage:
    if not isinstance(message, AIMessage):
        return message

    sanitized_content = sanitize_user_visible_content(message.content, artifacts=artifacts)
    if sanitized_content == message.content:
        return message

    return message.model_copy(update={"content": sanitized_content})


class UserVisiblePathSanitizerMiddleware(AgentMiddleware[AgentState]):
    """Remove runtime-internal `/mnt/user-data/...` paths from user-visible model text."""

    @staticmethod
    def _artifact_paths(state: AgentState[Any]) -> tuple[str, ...]:
        raw_artifacts = state.get("artifacts")
        if not isinstance(raw_artifacts, list):
            return ()
        return tuple(str(path).strip() for path in raw_artifacts if isinstance(path, str) and path.strip())

    @classmethod
    def _sanitize_model_response(
        cls,
        response: ModelResponse[Any] | ExtendedModelResponse[Any] | AIMessage,
        *,
        artifacts: Sequence[str],
    ) -> ModelResponse[Any] | ExtendedModelResponse[Any] | AIMessage:
        if isinstance(response, AIMessage):
            return sanitize_user_visible_message(response, artifacts=artifacts)

        if isinstance(response, ExtendedModelResponse):
            return ExtendedModelResponse(
                model_response=cls._sanitize_model_response(
                    response.model_response,
                    artifacts=artifacts,
                ),
                command=response.command,
            )

        sanitized_messages = [
            sanitize_user_visible_message(message, artifacts=artifacts)
            for message in response.result
        ]
        return ModelResponse(
            result=sanitized_messages,
            structured_response=response.structured_response,
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any] | ExtendedModelResponse[Any] | AIMessage:
        response = handler(request)
        return self._sanitize_model_response(
            response,
            artifacts=self._artifact_paths(request.state),
        )

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any] | ExtendedModelResponse[Any] | AIMessage:
        response = await handler(request)
        return self._sanitize_model_response(
            response,
            artifacts=self._artifact_paths(request.state),
        )


def _sorted_runtime_paths(paths: Sequence[str]) -> list[str]:
    return sorted(
        {path for path in paths if path.startswith("/mnt/user-data/")},
        key=len,
        reverse=True,
    )


def _basename_for_runtime_path(path: str) -> str | None:
    normalized = path.strip()
    if not normalized.startswith("/mnt/user-data/"):
        return None

    basename = PurePosixPath(normalized).name
    return basename or None


def _replace_generic_runtime_path(match: re.Match[str]) -> str:
    tail = (match.group("tail") or "").strip()
    if tail and tail != "/":
        basename = PurePosixPath(tail).name
        if basename:
            return f"`{basename}`"

    scope = match.group("scope")
    return _SCOPE_LABELS.get(scope, "file")
