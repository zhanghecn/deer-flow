"""Guard create-agent flows from bypassing setup_agent via raw filesystem writes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from typing import Any, override

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain.tools.tool_node import ToolCallRequest
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from langgraph.types import Command

from src.tools.builtins.runtime_context import runtime_context_value

_BLOCKED_CREATE_AGENT_TOOLS = frozenset({"write_file", "edit_file"})
_PROTECTED_AUTHORING_ROOTS = (
    "/mnt/user-data/agents",
    "/mnt/user-data/authoring/agents",
    "/mnt/user-data/authoring/skills",
)
_CREATE_AGENT_GUARD_ERROR = (
    "Error: `/create-agent` must use `setup_agent` for agent and skill materialization. "
    "Do not manually write agent files under `/mnt/user-data/agents/...` or "
    "`/mnt/user-data/authoring/...` with filesystem tools."
)


def should_enforce_setup_agent_guard(runtime_context: object) -> bool:
    command_name = runtime_context_value(runtime_context, "command_name")
    if str(command_name or "").strip() != "create-agent":
        return False

    target_agent_name = runtime_context_value(runtime_context, "target_agent_name")
    return bool(str(target_agent_name or "").strip())


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def is_protected_create_agent_path(file_path: object) -> bool:
    normalized = _normalize_text(file_path).lower()
    if not normalized:
        return False

    for root in _PROTECTED_AUTHORING_ROOTS:
        protected_root = root.lower()
        if normalized == protected_root or normalized.startswith(f"{protected_root}/"):
            return True
    return False


def _tool_call_args(tool_call: object) -> dict[str, Any]:
    if not isinstance(tool_call, dict):
        return {}
    args = tool_call.get("args")
    return args if isinstance(args, dict) else {}


def blocked_create_agent_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    if not should_enforce_setup_agent_guard(getattr(request.runtime, "context", None)):
        return None

    tool_name = _normalize_text(request.tool_call.get("name") if isinstance(request.tool_call, dict) else None)
    if tool_name in _BLOCKED_CREATE_AGENT_TOOLS:
        file_path = _tool_call_args(request.tool_call).get("file_path")
        if is_protected_create_agent_path(file_path):
            return ToolMessage(
                content=_CREATE_AGENT_GUARD_ERROR,
                tool_call_id=request.tool_call["id"],
            )

    if tool_name != "execute":
        return None

    command = _normalize_text(_tool_call_args(request.tool_call).get("command")).lower()
    if any(root.lower() in command for root in _PROTECTED_AUTHORING_ROOTS):
        return ToolMessage(
            content=_CREATE_AGENT_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )

    return None


def filter_create_agent_model_tools(tools: Sequence[BaseTool | dict[str, Any]]) -> list[BaseTool | dict[str, Any]]:
    filtered: list[BaseTool | dict[str, Any]] = []
    for tool in tools:
        name = _normalize_text(getattr(tool, "name", None) if not isinstance(tool, dict) else tool.get("name"))
        if name in _BLOCKED_CREATE_AGENT_TOOLS:
            continue
        filtered.append(tool)
    return filtered


class AuthoringGuardMiddleware(AgentMiddleware):
    """Block raw filesystem authoring when setup_agent is available."""

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        if not should_enforce_setup_agent_guard(request.runtime.context):
            return handler(request)

        filtered_tools = filter_create_agent_model_tools(request.tools)
        if len(filtered_tools) == len(request.tools):
            return handler(request)
        return handler(request.override(tools=filtered_tools))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        if not should_enforce_setup_agent_guard(request.runtime.context):
            return await handler(request)

        filtered_tools = filter_create_agent_model_tools(request.tools)
        if len(filtered_tools) == len(request.tools):
            return await handler(request)
        return await handler(request.override(tools=filtered_tools))

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        blocked = blocked_create_agent_tool_message(request)
        if blocked is not None:
            return blocked
        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        blocked = blocked_create_agent_tool_message(request)
        if blocked is not None:
            return blocked
        return await handler(request)
