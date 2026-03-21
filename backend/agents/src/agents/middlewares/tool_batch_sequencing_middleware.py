"""Retry model output when dependent tool calls are bundled into one batch."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage

logger = logging.getLogger(__name__)

_RETRY_TAG = "<tool_batch_sequencing_recovery>"
_FILE_MUTATION_TOOLS = frozenset({"write_file", "edit_file"})
_DEPENDENT_TOOLS = frozenset({"execute", "present_files"})
_RETRY_SYSTEM_PROMPT = """
<tool_batch_sequencing_recovery>
- Your previous tool batch mixed file writes/edits with `execute` or `present_files`.
- That can race and produce stale artifacts.
- Split dependent operations into separate turns.
- First complete `write_file` / `edit_file`.
- Wait for the tool result.
- Then run `execute`, `read_file`, or `present_files` in a later step if still needed.
</tool_batch_sequencing_recovery>
""".strip()


class ToolBatchSequencingMiddleware(AgentMiddleware):
    """Retry once when the model batches dependent tool calls unsafely."""

    @staticmethod
    def _last_ai_message(messages: list[BaseMessage]) -> AIMessage | None:
        for message in reversed(messages):
            if isinstance(message, AIMessage):
                return message
        return None

    @staticmethod
    def _tool_names(message: AIMessage) -> tuple[str, ...]:
        names: list[str] = []
        for tool_call in message.tool_calls or []:
            if not isinstance(tool_call, dict):
                continue
            name = str(tool_call.get("name") or "").strip()
            if name:
                names.append(name)
        return tuple(names)

    @staticmethod
    def _system_message_text(system_message: Any) -> str:
        if isinstance(system_message, SystemMessage):
            return system_message.text
        return str(system_message or "")

    def _should_retry(self, request: ModelRequest[Any], response: ModelResponse[Any]) -> bool:
        if _RETRY_TAG in self._system_message_text(request.system_message):
            return False

        message = self._last_ai_message(response.result)
        if message is None or len(message.tool_calls or []) < 2:
            return False

        tool_names = self._tool_names(message)
        if not tool_names:
            return False

        has_file_mutation = any(name in _FILE_MUTATION_TOOLS for name in tool_names)
        has_dependent_tool = any(name in _DEPENDENT_TOOLS for name in tool_names)
        return has_file_mutation and has_dependent_tool

    def _retry_request(self, request: ModelRequest[Any]) -> ModelRequest[Any]:
        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                _RETRY_SYSTEM_PROMPT,
            )
        )

    def _handle_retry(
        self,
        request: ModelRequest[Any],
        response: ModelResponse[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        if not self._should_retry(request, response):
            return response

        logger.info("Retrying model call after mixed file mutation + dependent tools batch")
        return handler(self._retry_request(request))

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        response = handler(request)
        return self._handle_retry(request, response, handler)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        response = await handler(request)
        if not self._should_retry(request, response):
            return response

        logger.info("Retrying async model call after mixed file mutation + dependent tools batch")
        return await handler(self._retry_request(request))
