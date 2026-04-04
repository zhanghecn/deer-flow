"""Guard authoring flows from bypassing the canonical persistence tools."""

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

from src.config.builtin_agents import LEAD_AGENT_NAME, normalize_effective_agent_name
from src.utils.runtime_context import runtime_context_value

_BLOCKED_CREATE_AGENT_TOOLS = frozenset({"write_file", "edit_file"})
_BLOCKED_SELF_AGENT_MUTATION_TOOLS = frozenset({"write_file", "edit_file"})
_BLOCKED_LEAD_AGENT_RUNTIME_AGENT_MUTATION_TOOLS = frozenset({"write_file", "edit_file"})
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
_SKILL_LIBRARY_ROOT = "/mnt/skills"
_SKILL_ARCHIVE_ROOTS = (
    "/mnt/skills/system/skills",
    "/mnt/skills/custom/skills",
    "/mnt/skills/store",
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
_LEADING_COMMAND_FRAGMENT_RE = re.compile(r"^(?:&&|\|\||[|;,:<>\])}])")
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
_READ_ONLY_CREATE_AGENT_TOOLS = frozenset(
    {
        "glob",
        "grep",
        "list_dir",
        "ls",
        "read_file",
    }
)
_CREATE_AGENT_GUARD_ERROR = (
    "Error: `/create-agent` must use `setup_agent` for agent and skill materialization. "
    "Use canonical runtime roots only: `/mnt/user-data/agents/...`, `/mnt/user-data/authoring/...`, "
    "`/mnt/user-data/uploads`, `/mnt/user-data/workspace`, `/mnt/user-data/outputs`, and "
    "read-only archived skill discovery under `/mnt/skills/system/skills/...`, "
    "`/mnt/skills/custom/skills/...`, or the legacy migration input `/mnt/skills/store/...`. "
    "Do not invent alternate paths such as `/mnt/user-data/agentz`, and do not read or write "
    "host/package paths like `/agents`, `/app`, raw `/mnt` outside those roots, `.openagents`, "
    "or `~/.agents` with filesystem tools."
)
_SELF_AGENT_PERSISTENCE_GUARD_ERROR = (
    "Error: updating the current dev agent must persist through `setup_agent`, not by mutating "
    "the thread-local runtime copy under `/mnt/user-data/agents/...`. Read the current AGENTS.md "
    "or owned SKILL.md first, then call `setup_agent` with the full updated content."
)
_LEAD_AGENT_RUNTIME_AGENT_PERSISTENCE_GUARD_ERROR = (
    "Error: lead_agent must materialize or update agent archives through `setup_agent`, not by "
    "mutating `/mnt/user-data/agents/...` with file edits, shell copies, or directory creation."
)
_LEAD_AGENT_SKILL_INSTALL_GUARD_ERROR = (
    "Error: install reusable skills with `install_skill_from_registry(source=\"...\")`, not by "
    "running `git clone`, `npx skills add`, or similar shell installation steps."
)
_AUTHORING_ABSOLUTE_PATH_GUARD_ERROR = (
    "Error: filesystem path arguments in authoring/runtime turns must be explicit absolute virtual paths "
    "starting with `/`. Use canonical runtime paths like `/mnt/user-data/...` or archived skill paths like "
    "`/mnt/skills/...`, not relative paths, line-number fragments, or partial tool payloads."
)
_AUTHORING_EXECUTE_FRAGMENT_GUARD_ERROR = (
    "Error: `execute.command` must be a concrete shell command or script path. "
    "Do not pass partial tool payloads, line-number fragments, or shell no-op fragments."
)
_DIRECT_AUTHORING_HELPER_TOOLS = frozenset({"question", "present_files", "view_image"})
_FILESYSTEM_PATH_ARG_BY_TOOL = {
    "ls": "path",
    "read_file": "file_path",
    "write_file": "file_path",
    "edit_file": "file_path",
    "glob": "path",
    "grep": "path",
}


def _runtime_authoring_actions(runtime_context: object) -> tuple[str, ...]:
    raw_actions = runtime_context_value(runtime_context, "authoring_actions")
    if not isinstance(raw_actions, list):
        return ()

    normalized: list[str] = []
    seen: set[str] = set()
    for action in raw_actions:
        text = _normalize_text(action)
        if not text or text in seen:
            continue
        normalized.append(text)
        seen.add(text)
    return tuple(normalized)


def should_enforce_setup_agent_guard(runtime_context: object) -> bool:
    command_name = runtime_context_value(runtime_context, "command_name")
    return str(command_name or "").strip() == "create-agent"


def should_enforce_self_agent_persistence_guard(runtime_context: object) -> bool:
    if _normalize_text(runtime_context_value(runtime_context, "agent_status")) != "dev":
        return False
    current_agent = normalize_effective_agent_name(runtime_context_value(runtime_context, "agent_name"))
    return current_agent != LEAD_AGENT_NAME


def should_enforce_lead_agent_dev_authoring_guard(runtime_context: object) -> bool:
    if _normalize_text(runtime_context_value(runtime_context, "agent_status")) != "dev":
        return False
    current_agent = normalize_effective_agent_name(runtime_context_value(runtime_context, "agent_name"))
    return current_agent == LEAD_AGENT_NAME


def should_enforce_direct_authoring_guard(runtime_context: object) -> bool:
    # `/create-agent` still needs normal authoring orchestration before the
    # final `setup_agent` call, so do not collapse it into the exclusive
    # save/push guard even if stale runtime metadata marks it as hard.
    if _normalize_text(runtime_context_value(runtime_context, "command_name")) == "create-agent":
        return False
    command_kind = _normalize_text(runtime_context_value(runtime_context, "command_kind"))
    return command_kind == "hard" and len(_runtime_authoring_actions(runtime_context)) > 0


def _direct_authoring_allowed_tool_names(runtime_context: object) -> frozenset[str]:
    return frozenset(_runtime_authoring_actions(runtime_context)) | _DIRECT_AUTHORING_HELPER_TOOLS


def _direct_authoring_guard_error(runtime_context: object) -> str:
    command_name = _normalize_text(runtime_context_value(runtime_context, "command_name")) or "this command"
    allowed_actions = ", ".join(_runtime_authoring_actions(runtime_context)) or "the matching authoring tool"
    return (
        f"Error: `/{command_name}` is an explicit persistence/publish confirmation. "
        f"Use only {allowed_actions} for this turn, or briefly explain the blocker. "
        "Do not use filesystem, shell, registry-install, or host-path workaround tools."
    )


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


def uses_forbidden_create_agent_host_path(
    value: object,
    *,
    allow_skill_library_reads: bool = False,
) -> bool:
    normalized = _normalize_text(value).lower()
    if not normalized:
        return False
    if any(hint in normalized for hint in _FORBIDDEN_HOST_PATH_HINTS):
        return True
    for token in _absolute_path_tokens(normalized):
        if _is_allowed_runtime_path(token):
            continue
        if allow_skill_library_reads and _is_allowed_skill_library_path(token):
            continue
        return True
    return False


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


def _is_allowed_skill_library_path(path: str) -> bool:
    normalized = _normalize_text(path).lower()
    if normalized == _SKILL_LIBRARY_ROOT:
        return True
    return any(
        normalized == archive_root or normalized.startswith(f"{archive_root}/")
        for archive_root in _SKILL_ARCHIVE_ROOTS
    )


def uses_forbidden_create_agent_path_arg(
    value: object,
    *,
    allow_skill_library_reads: bool = False,
) -> bool:
    normalized = _normalize_text(value).lower()
    if not normalized:
        return False
    if any(hint in normalized for hint in _FORBIDDEN_HOST_PATH_HINTS):
        return True
    if not normalized.startswith("/"):
        return False
    if _is_allowed_runtime_path(normalized):
        return False
    if allow_skill_library_reads and _is_allowed_skill_library_path(normalized):
        return False
    return True


def _current_runtime_agent_root(runtime_context: object) -> str | None:
    current_agent = normalize_effective_agent_name(runtime_context_value(runtime_context, "agent_name"))
    agent_status = _normalize_text(runtime_context_value(runtime_context, "agent_status")) or "dev"
    if current_agent == LEAD_AGENT_NAME:
        return None
    return f"/mnt/user-data/agents/{agent_status}/{current_agent}".lower()


def is_current_agent_runtime_path(file_path: object, runtime_context: object) -> bool:
    normalized = _normalize_text(file_path).lower()
    runtime_root = _current_runtime_agent_root(runtime_context)
    if not normalized or not runtime_root:
        return False
    return normalized == runtime_root or normalized.startswith(f"{runtime_root}/")


def is_runtime_agents_path(file_path: object) -> bool:
    normalized = _normalize_text(file_path).lower()
    return normalized == "/mnt/user-data/agents" or normalized.startswith("/mnt/user-data/agents/")


def _tool_call_args(tool_call: object) -> dict[str, Any]:
    if not isinstance(tool_call, dict):
        return {}
    args = tool_call.get("args")
    return args if isinstance(args, dict) else {}


def _authoring_relative_path_error(
    *,
    tool_name: str,
    arg_name: str,
    value: object,
) -> str:
    return (
        f"{_AUTHORING_ABSOLUTE_PATH_GUARD_ERROR} "
        f"Received `{tool_name}.{arg_name}={value!r}`."
    )


def _authoring_malformed_execute_error(command: object) -> str:
    return f"{_AUTHORING_EXECUTE_FRAGMENT_GUARD_ERROR} Received `command={command!r}`."


def _non_absolute_authoring_path_error(
    *,
    tool_name: str,
    tool_args: dict[str, Any],
) -> str | None:
    arg_name = _FILESYSTEM_PATH_ARG_BY_TOOL.get(tool_name)
    if arg_name is None:
        return None

    raw_value = tool_args.get(arg_name)
    normalized_value = _normalize_text(raw_value)
    if not normalized_value:
        return None
    if normalized_value.startswith("/"):
        return None
    return _authoring_relative_path_error(tool_name=tool_name, arg_name=arg_name, value=raw_value)


def _looks_like_malformed_execute_fragment(command: object) -> bool:
    normalized = _normalize_text(command)
    if not normalized:
        return False
    lowered = normalized.lower()
    if "<invoke" in lowered or "</invoke" in lowered:
        return True
    if _LEADING_COMMAND_FRAGMENT_RE.match(normalized):
        return True
    # Require at least one concrete command/script token character so fragments
    # like `: 0,` fail fast instead of becoming misleading shell no-ops.
    return re.search(r"[A-Za-z_./-]", normalized) is None


def _is_shell_skill_install_attempt(command: object) -> bool:
    normalized = _normalize_text(command).lower()
    if not normalized:
        return False
    if "install-skills" in normalized:
        return True
    if "npx" in normalized and "skills add" in normalized:
        return True
    return "git clone" in normalized and "skills.git" in normalized


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
    allow_skill_library_reads = tool_name in _READ_ONLY_CREATE_AGENT_TOOLS

    relative_path_error = _non_absolute_authoring_path_error(
        tool_name=tool_name,
        tool_args=tool_args,
    )
    if relative_path_error is not None:
        return ToolMessage(
            content=relative_path_error,
            tool_call_id=request.tool_call["id"],
        )

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
        if uses_forbidden_create_agent_path_arg(
            tool_args.get(key),
            allow_skill_library_reads=allow_skill_library_reads,
        ):
            return ToolMessage(
                content=_CREATE_AGENT_GUARD_ERROR,
                tool_call_id=request.tool_call["id"],
            )

    if tool_name != "execute":
        return None

    command = _normalize_text(tool_args.get("command"))
    if _looks_like_malformed_execute_fragment(command):
        return ToolMessage(
            content=_authoring_malformed_execute_error(tool_args.get("command")),
            tool_call_id=request.tool_call["id"],
        )
    normalized_command = command.lower()
    if any(root.lower() in normalized_command for root in _PROTECTED_AUTHORING_ROOTS) and not (
        is_read_only_create_agent_shell_command(command)
    ):
        return ToolMessage(
            content=_CREATE_AGENT_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )
    if uses_forbidden_create_agent_host_path(
        normalized_command,
        allow_skill_library_reads=is_read_only_create_agent_shell_command(command),
    ):
        return ToolMessage(
            content=_CREATE_AGENT_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )

    return None


def blocked_self_agent_persistence_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    runtime_context = getattr(request.runtime, "context", None)
    if not should_enforce_self_agent_persistence_guard(runtime_context):
        return None

    tool_name = _normalize_text(request.tool_call.get("name") if isinstance(request.tool_call, dict) else None)
    tool_args = _tool_call_args(request.tool_call)

    if tool_name in _BLOCKED_SELF_AGENT_MUTATION_TOOLS and is_current_agent_runtime_path(
        tool_args.get("file_path"),
        runtime_context,
    ):
        return ToolMessage(
            content=_SELF_AGENT_PERSISTENCE_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )

    if tool_name != "execute":
        return None

    command = _normalize_text(tool_args.get("command"))
    runtime_root = _current_runtime_agent_root(runtime_context)
    if runtime_root and runtime_root in command.lower() and not is_read_only_create_agent_shell_command(command):
        return ToolMessage(
            content=_SELF_AGENT_PERSISTENCE_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )

    return None


def blocked_lead_agent_dev_authoring_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    runtime_context = getattr(request.runtime, "context", None)
    if not should_enforce_lead_agent_dev_authoring_guard(runtime_context):
        return None

    tool_name = _normalize_text(request.tool_call.get("name") if isinstance(request.tool_call, dict) else None)
    tool_args = _tool_call_args(request.tool_call)

    relative_path_error = _non_absolute_authoring_path_error(
        tool_name=tool_name,
        tool_args=tool_args,
    )
    if relative_path_error is not None:
        return ToolMessage(
            content=relative_path_error,
            tool_call_id=request.tool_call["id"],
        )

    if tool_name in _BLOCKED_LEAD_AGENT_RUNTIME_AGENT_MUTATION_TOOLS and is_runtime_agents_path(
        tool_args.get("file_path")
    ):
        return ToolMessage(
            content=_LEAD_AGENT_RUNTIME_AGENT_PERSISTENCE_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )

    if tool_name != "execute":
        return None

    command = _normalize_text(tool_args.get("command"))
    if _looks_like_malformed_execute_fragment(command):
        return ToolMessage(
            content=_authoring_malformed_execute_error(tool_args.get("command")),
            tool_call_id=request.tool_call["id"],
        )
    if _is_shell_skill_install_attempt(command):
        return ToolMessage(
            content=_LEAD_AGENT_SKILL_INSTALL_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )
    if "/mnt/user-data/agents" in command.lower() and not is_read_only_create_agent_shell_command(command):
        return ToolMessage(
            content=_LEAD_AGENT_RUNTIME_AGENT_PERSISTENCE_GUARD_ERROR,
            tool_call_id=request.tool_call["id"],
        )

    return None


def blocked_direct_authoring_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    runtime_context = getattr(request.runtime, "context", None)
    if not should_enforce_direct_authoring_guard(runtime_context):
        return None

    tool_name = _normalize_text(request.tool_call.get("name") if isinstance(request.tool_call, dict) else None)
    if tool_name in _direct_authoring_allowed_tool_names(runtime_context):
        return None

    return ToolMessage(
        content=_direct_authoring_guard_error(runtime_context),
        tool_call_id=request.tool_call["id"],
    )


def filter_create_agent_model_tools(tools: Sequence[BaseTool | dict[str, Any]]) -> list[BaseTool | dict[str, Any]]:
    filtered: list[BaseTool | dict[str, Any]] = []
    for tool in tools:
        name = _normalize_text(getattr(tool, "name", None) if not isinstance(tool, dict) else tool.get("name"))
        if name in _BLOCKED_CREATE_AGENT_TOOLS:
            continue
        filtered.append(tool)
    return filtered


def filter_direct_authoring_model_tools(
    tools: Sequence[BaseTool | dict[str, Any]],
    *,
    runtime_context: object,
) -> list[BaseTool | dict[str, Any]]:
    allowed_names = _direct_authoring_allowed_tool_names(runtime_context)
    filtered: list[BaseTool | dict[str, Any]] = []
    for tool in tools:
        name = _normalize_text(getattr(tool, "name", None) if not isinstance(tool, dict) else tool.get("name"))
        if name in allowed_names:
            filtered.append(tool)
    return filtered


class AuthoringGuardMiddleware(AgentMiddleware):
    """Keep authoring turns on the supported persistence path."""

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        if should_enforce_direct_authoring_guard(request.runtime.context):
            filtered_tools = filter_direct_authoring_model_tools(
                request.tools,
                runtime_context=request.runtime.context,
            )
            if len(filtered_tools) == len(request.tools):
                return handler(request)
            return handler(request.override(tools=filtered_tools))

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
        if should_enforce_direct_authoring_guard(request.runtime.context):
            filtered_tools = filter_direct_authoring_model_tools(
                request.tools,
                runtime_context=request.runtime.context,
            )
            if len(filtered_tools) == len(request.tools):
                return await handler(request)
            return await handler(request.override(tools=filtered_tools))

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
        blocked = blocked_lead_agent_dev_authoring_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_self_agent_persistence_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_direct_authoring_tool_message(request)
        if blocked is not None:
            return blocked
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
        blocked = blocked_lead_agent_dev_authoring_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_self_agent_persistence_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_direct_authoring_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_create_agent_tool_message(request)
        if blocked is not None:
            return blocked
        return await handler(request)
