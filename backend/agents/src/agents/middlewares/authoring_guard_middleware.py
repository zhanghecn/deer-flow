"""Guard create-agent flows from bypassing setup_agent via raw filesystem writes."""

from __future__ import annotations

import re
import shlex
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
_FORBIDDEN_HOST_PATH_HINTS = (
    "/app",
    ".openagents",
    "~/.agents",
    "/root/.agents",
    "/home/user/.local",
)
_CANONICAL_RUNTIME_TOP_LEVEL_DIRS = frozenset(
    {
        "agents",
        "authoring",
        "outputs",
        "uploads",
        "workspace",
    }
)
_ABSOLUTE_PATH_TOKEN_RE = re.compile(r"/[^\s'\"`|;&()<>{}\[\]]+")
_DEV_NULL_REDIRECTION_RE = re.compile(r"\d*>>?\s*/dev/null\b")
_READ_ONLY_SHELL_SEGMENT_COMMANDS = frozenset(
    {
        "cat",
        "file",
        "find",
        "grep",
        "head",
        "ls",
        "readlink",
        "realpath",
        "stat",
        "tail",
        "test",
        "tree",
        "wc",
    }
)
_CREATE_AGENT_GUARD_ERROR = (
    "Error: `/create-agent` must use `setup_agent` for agent and skill materialization. "
    "Use canonical runtime roots only: `/mnt/user-data/agents/...`, `/mnt/user-data/authoring/...`, "
    "`/mnt/user-data/uploads`, `/mnt/user-data/workspace`, and `/mnt/user-data/outputs`. "
    "Do not invent alternate paths such as `/mnt/user-data/agentz`, and do not read or write "
    "host/package paths like `/agents`, `/app`, raw `/mnt`, `.openagents`, or `~/.agents` with filesystem tools."
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


def uses_forbidden_create_agent_host_path(value: object) -> bool:
    normalized = _normalize_text(value).lower()
    if not normalized:
        return False
    if any(hint in normalized for hint in _FORBIDDEN_HOST_PATH_HINTS):
        return True
    return any(not _is_allowed_runtime_path(token) for token in _absolute_path_tokens(normalized))


def _absolute_path_tokens(value: str) -> tuple[str, ...]:
    return tuple(match.group(0) for match in _ABSOLUTE_PATH_TOKEN_RE.finditer(value))


def _is_allowed_runtime_path(path: str) -> bool:
    normalized = _normalize_text(path).lower()
    if normalized == "/dev/null":
        return True
    if normalized == "/mnt/user-data":
        return True
    if not normalized.startswith("/mnt/user-data/"):
        return False

    remainder = normalized[len("/mnt/user-data/") :]
    if not remainder:
        return True
    first_segment = remainder.split("/", 1)[0]
    return first_segment in _CANONICAL_RUNTIME_TOP_LEVEL_DIRS


def uses_forbidden_create_agent_path_arg(value: object) -> bool:
    normalized = _normalize_text(value).lower()
    if not normalized:
        return False
    if any(hint in normalized for hint in _FORBIDDEN_HOST_PATH_HINTS):
        return True
    if not normalized.startswith("/"):
        return False
    return not _is_allowed_runtime_path(normalized)


def _tool_call_args(tool_call: object) -> dict[str, Any]:
    if not isinstance(tool_call, dict):
        return {}
    args = tool_call.get("args")
    return args if isinstance(args, dict) else {}


def _is_read_only_shell_segment(segment: str) -> bool:
    try:
        parts = shlex.split(segment)
    except ValueError:
        return False

    if not parts:
        return False

    command = parts[0].lower()
    if command in _READ_ONLY_SHELL_SEGMENT_COMMANDS:
        return True
    if command == "sed" and len(parts) > 1 and parts[1] == "-n":
        return True
    if command == "[":
        return True
    return False


def is_read_only_create_agent_shell_command(command: object) -> bool:
    normalized = _normalize_text(command)
    if not normalized:
        return False

    stripped = _DEV_NULL_REDIRECTION_RE.sub("", normalized)
    if any(marker in stripped for marker in ("&&", "||", ";", "$(", "`", "\n", ">", "<")):
        return False

    segments = [segment.strip() for segment in stripped.split("|") if segment.strip()]
    if not segments:
        return False

    return all(_is_read_only_shell_segment(segment) for segment in segments)


def blocked_create_agent_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    if not should_enforce_setup_agent_guard(getattr(request.runtime, "context", None)):
        return None

    tool_name = _normalize_text(request.tool_call.get("name") if isinstance(request.tool_call, dict) else None)
    tool_args = _tool_call_args(request.tool_call)

    if tool_name in _BLOCKED_CREATE_AGENT_TOOLS:
        file_path = tool_args.get("file_path")
        if is_protected_create_agent_path(file_path):
            return ToolMessage(
                content=_CREATE_AGENT_GUARD_ERROR,
                tool_call_id=request.tool_call["id"],
            )
        if uses_forbidden_create_agent_host_path(file_path):
            return ToolMessage(
                content=_CREATE_AGENT_GUARD_ERROR,
                tool_call_id=request.tool_call["id"],
            )

    for key in ("path", "pattern", "glob", "file_path"):
        if uses_forbidden_create_agent_path_arg(tool_args.get(key)):
            return ToolMessage(
                content=_CREATE_AGENT_GUARD_ERROR,
                tool_call_id=request.tool_call["id"],
            )

    if tool_name != "execute":
        return None

    command = _normalize_text(tool_args.get("command"))
    normalized_command = command.lower()
    if any(root.lower() in normalized_command for root in _PROTECTED_AUTHORING_ROOTS) and not (
        is_read_only_create_agent_shell_command(command)
    ):
        return ToolMessage(
            content=_CREATE_AGENT_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )
    if uses_forbidden_create_agent_host_path(normalized_command):
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
