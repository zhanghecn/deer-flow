"""Inject backend-resolved slash-command instructions at runtime."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse

from src.tools.builtins.runtime_context import runtime_context_value


def _normalize_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_authoring_actions(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _normalize_text(item)
        if text is None or text in seen:
            continue
        normalized.append(text)
        seen.add(text)
    return tuple(normalized)


def _normalize_skills_metadata(value: object) -> tuple[dict[str, str], ...]:
    if not isinstance(value, list):
        return ()

    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _normalize_text(item.get("name"))
        path = _normalize_text(item.get("path"))
        if name is None or path is None:
            continue
        normalized.append({"name": name, "path": path})
    return tuple(normalized)


def _resolve_referenced_skill_paths(
    state: object,
    referenced_skill_names: tuple[str, ...],
) -> tuple[tuple[tuple[str, str], ...], tuple[str, ...]]:
    if not referenced_skill_names:
        return (), ()

    if not isinstance(state, dict):
        return (), referenced_skill_names

    skills_metadata = _normalize_skills_metadata(state.get("skills_metadata"))
    by_name = {item["name"]: item["path"] for item in skills_metadata}

    available: list[tuple[str, str]] = []
    unavailable: list[str] = []
    for name in referenced_skill_names:
        path = by_name.get(name)
        if path is None:
            unavailable.append(name)
            continue
        available.append((name, path))

    return tuple(available), tuple(unavailable)


def build_runtime_command_prompt(runtime_context: object, state: object | None = None) -> str:
    command_name = _normalize_text(runtime_context_value(runtime_context, "command_name"))
    command_kind = _normalize_text(runtime_context_value(runtime_context, "command_kind"))
    command_args = _normalize_text(runtime_context_value(runtime_context, "command_args"))
    command_prompt = _normalize_text(runtime_context_value(runtime_context, "command_prompt"))
    agent_status = _normalize_text(runtime_context_value(runtime_context, "agent_status")) or "dev"
    target_agent_name = _normalize_text(runtime_context_value(runtime_context, "target_agent_name"))
    authoring_actions = _normalize_authoring_actions(
        runtime_context_value(runtime_context, "authoring_actions")
    )
    referenced_skill_names = _normalize_authoring_actions(
        runtime_context_value(runtime_context, "referenced_skill_names")
    )

    if not command_name and not authoring_actions and not command_prompt and not referenced_skill_names:
        return ""

    blocks: list[str] = []

    if command_name or authoring_actions or command_prompt:
        lines = [
            "<runtime_command>",
            f"- command_name: {command_name or 'none'}",
            f"- command_kind: {command_kind or 'none'}",
            f"- command_args: {command_args or 'none'}",
        ]
        if authoring_actions:
            lines.append(f"- allowed_authoring_actions: {', '.join(authoring_actions)}")

        if command_kind == "hard":
            lines.extend(
                [
                    "- This turn is an explicit user confirmation to persist or publish authored content.",
                    "- First priority: if the matching authoring tool is available and prerequisites are satisfied, call it before any other work.",
                    "- Do not continue drafting, refactoring, or filesystem editing before attempting the matching authoring tool.",
                    "- If the tool fails, explain the blocker briefly and ask only the minimal clarification needed.",
                ]
            )
        else:
            lines.append("- This command provides runtime intent only. You still decide the workflow based on the user's request.")

        if command_name == "create-agent" and target_agent_name:
            canonical_target_root = f"/mnt/user-data/agents/{agent_status}/{target_agent_name}"
            lines.extend(
                [
                    f"- canonical_target_agent_runtime_root: {canonical_target_root}",
                    "- Use that exact `/mnt/user-data/agents/...` root for any read-only inspection of the existing target archive in this thread.",
                    "- Do not invent sibling runtime directories such as `/mnt/user-data/agentz`.",
                    "- If the target archive is absent at that exact runtime root, do not guess alternate filesystem locations; call `setup_agent` or explain the blocker.",
                ]
            )

        if command_prompt:
            lines.append("- Follow the backend-resolved command instruction below when it is relevant to the user's request.")

        lines.append("</runtime_command>")
        blocks.append("\n".join(lines))

        if command_prompt:
            blocks.append(
                "\n".join(
                    [
                        "<runtime_command_instruction>",
                        command_prompt,
                        "</runtime_command_instruction>",
                    ]
                )
            )

    if referenced_skill_names:
        available_references, unavailable_references = _resolve_referenced_skill_paths(
            state,
            referenced_skill_names,
        )
        blocks.append(
            "\n".join(
                [
                    "<runtime_skill_references>",
                    f"- referenced_skill_names: {', '.join(referenced_skill_names)}",
                    "- The user explicitly referenced these skills with `$skill_name`.",
                    *(
                        [
                            "- The backend already resolved these referenced skills as available in the current runtime:",
                            *[
                                f"  - {name}: {path}"
                                for name, path in available_references
                            ],
                            "- Treat every listed skill above as present and usable for this turn.",
                            "- Do not claim that a listed referenced skill is unavailable, missing, or outside the current skills directory.",
                            "- If you need the instructions, read the listed `SKILL.md` path directly.",
                        ]
                        if available_references
                        else [
                            "- No referenced skills were confirmed from runtime state in this turn.",
                        ]
                    ),
                    *(
                        [
                            f"- Referenced skills not confirmed in runtime state: {', '.join(unavailable_references)}",
                            "- Only say a referenced skill is unavailable when it appears in this unconfirmed list or the runtime skill inventory does not include it.",
                        ]
                        if unavailable_references
                        else [
                            "- All referenced skills were confirmed in the current runtime.",
                        ]
                    ),
                    "</runtime_skill_references>",
                ],
            )
        )

    return "\n".join(blocks)


class RuntimeCommandMiddleware(AgentMiddleware):
    """Append resolved slash-command guidance without baking it into the base prompt."""

    @staticmethod
    def _override_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        command_prompt = build_runtime_command_prompt(request.runtime.context, request.state)
        if not command_prompt:
            return request

        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                command_prompt,
            )
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        return handler(self._override_request(request))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        return await handler(self._override_request(request))
