import json
import logging
import re
from pathlib import Path

from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime

from src.config.paths import get_paths
from src.skills import find_archived_skills_by_name
from src.tools.builtins.authoring_persistence import (
    RegistrySkillInstallResult,
    install_registry_skill_to_store,
)
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)
_EXPLICIT_URL_PATTERN = re.compile(r"https?://[^\s<>()\[\]\"']+")


def _parse_embedded_registry_payload(source: str) -> dict[str, object] | None:
    normalized_source = str(source or "").strip()
    if not normalized_source:
        return None

    candidates: list[str] = [normalized_source]
    colon_trimmed = normalized_source.lstrip(":").strip()
    if colon_trimmed and colon_trimmed not in candidates:
        candidates.append(colon_trimmed)

    first_brace = normalized_source.find("{")
    last_brace = normalized_source.rfind("}")
    if 0 <= first_brace < last_brace:
        embedded_object = normalized_source[first_brace : last_brace + 1].strip()
        if embedded_object and embedded_object not in candidates:
            candidates.append(embedded_object)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _normalize_registry_install_request(*, source: str, skill_name: str | None) -> tuple[str, str | None]:
    normalized_source = str(source or "").strip()
    normalized_skill_name = str(skill_name).strip() if skill_name is not None and str(skill_name).strip() else None

    # Some OpenAI-compatible/Anthropic-compatible providers occasionally stringify
    # the whole tool payload into the first string arg. Accept that malformed shape
    # here so registry installation stays a generic runtime capability instead of a
    # provider-specific prompt hack.
    payload = _parse_embedded_registry_payload(normalized_source)
    if payload is None:
        return normalized_source, normalized_skill_name

    payload_source = payload.get("source")
    if isinstance(payload_source, str) and payload_source.strip():
        normalized_source = payload_source.strip()

    if normalized_skill_name is None:
        for key in ("skill_name", "skillName", "name"):
            payload_skill_name = payload.get(key)
            if isinstance(payload_skill_name, str) and payload_skill_name.strip():
                normalized_skill_name = payload_skill_name.strip()
                break

    if normalized_source != str(source or "").strip() or normalized_skill_name != skill_name:
        logger.warning(
            "Normalized embedded registry-install payload from source=%r to source=%r skill_name=%r",
            source,
            normalized_source,
            normalized_skill_name,
        )

    return normalized_source, normalized_skill_name


def _candidate_skill_name(*, source: str, skill_name: str | None) -> str | None:
    normalized_name = str(skill_name or "").strip()
    if normalized_name:
        return normalized_name
    normalized_source = str(source or "").strip()
    if "@" not in normalized_source:
        return None
    _, inferred_name = normalized_source.rsplit("@", 1)
    inferred_name = inferred_name.strip()
    return inferred_name or None


def _message_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                item_type = str(item.get("type") or "").strip().lower()
                if item_type == "text":
                    text_value = item.get("text")
                    if isinstance(text_value, str) and text_value.strip():
                        text_parts.append(text_value)
                    continue
            text_parts.append(str(item))
        return "\n".join(part for part in text_parts if part)
    return str(content or "")


def _latest_human_message_text(runtime: ToolRuntime) -> str:
    state = getattr(runtime, "state", None)
    if not isinstance(state, dict):
        return ""

    raw_messages = state.get("messages")
    if not isinstance(raw_messages, list):
        return ""

    for message in reversed(raw_messages):
        message_type = str(getattr(message, "type", "") or "").strip().lower()
        if message_type == "human":
            return _message_text(getattr(message, "content", ""))
        if isinstance(message, dict) and str(message.get("type") or "").strip().lower() == "human":
            return _message_text(message.get("content", ""))
    return ""


def _trim_explicit_url(raw_url: str) -> str:
    return raw_url.rstrip(".,;:!?)\u3002\uff0c\uff1b\uff1a\uff01\uff09")


def _unique_explicit_url(text: object) -> str:
    normalized_text = str(text or "")
    explicit_urls = {_trim_explicit_url(match.group(0)) for match in _EXPLICIT_URL_PATTERN.finditer(normalized_text)}
    explicit_urls.discard("")
    if len(explicit_urls) != 1:
        return ""
    return next(iter(explicit_urls))


def _looks_like_registry_source(source: object) -> bool:
    normalized_source = str(source or "").strip()
    if not normalized_source:
        return False
    if any(marker in normalized_source for marker in ("<|", "|>", "\n", "\r", "{", "}")):
        return False
    if any(char.isspace() for char in normalized_source):
        return False
    if normalized_source.startswith(("http://", "https://")):
        return True
    return "/" in normalized_source


def _infer_source_from_runtime_message(runtime: ToolRuntime, *, source: str) -> str:
    normalized_source = str(source or "").strip()
    source_url = _unique_explicit_url(normalized_source)
    if source_url:
        return source_url
    if normalized_source and _looks_like_registry_source(normalized_source):
        return normalized_source

    message_text = _latest_human_message_text(runtime)
    if not message_text:
        return normalized_source

    # This is an explicit syntax fallback only: if the current turn contains one
    # unique bare URL and the model emitted `source=""` or malformed tool-call
    # residue, recover that exact URL instead of re-parsing user intent or
    # guessing a business target.
    message_url = _unique_explicit_url(message_text)
    if message_url and not _looks_like_registry_source(normalized_source):
        return message_url
    return normalized_source


def _archive_source_path(match: object) -> str:
    direct_source_path = str(getattr(match, "source_path", "") or "").strip()
    if direct_source_path:
        return direct_source_path

    category = str(getattr(match, "category", "") or "").strip()
    skill_path = str(getattr(match, "skill_path", "") or "").strip()
    skill_dir = getattr(match, "skill_dir", None)
    fallback_name = Path(skill_dir).name if skill_dir is not None else ""
    relative_path = skill_path or fallback_name
    if category in {"system", "custom"}:
        return Path(category, "skills", relative_path).as_posix()
    return Path(category, relative_path).as_posix()


def _format_install_result(result: RegistrySkillInstallResult) -> str:
    installed_names = [skill.name for skill in result.installed_skills]
    skipped_labels = [
        f"{skill.relative_path.as_posix()} ({', '.join(skill.existing_scopes)})"
        for skill in result.skipped_skills
    ]

    if len(installed_names) == 1 and not skipped_labels:
        return f"Skill '{installed_names[0]}' installed successfully to .openagents/custom/skills."

    if installed_names:
        summary = (
            f"Installed {len(installed_names)} skills to .openagents/custom/skills: "
            f"{', '.join(installed_names)}."
        )
    else:
        summary = "No new skills were installed into .openagents/custom/skills."

    if skipped_labels:
        return f"{summary} Skipped existing skills: {', '.join(skipped_labels)}."
    return summary


@tool("install_skill_from_registry", parse_docstring=True)
def install_skill_from_registry(
    runtime: ToolRuntime,
    source: str,
    skill_name: str | None = None,
) -> str:
    """Download external skills from an explicit registry source into the custom skill store.

    Pass the exact external source in `source`.
    To install all skills from a repo root, pass the repo URL/path and leave `skill_name` empty.
    To install one skill from a broader source, pass the repo source and the specific `skill_name`.

    Args:
        source: Required registry source such as `https://github.com/MiniMax-AI/skills.git`, `owner/repo@skill-name`, or another bare repo URL/path.
        skill_name: Optional explicit skill name when selecting one skill from a broader source.
    """

    try:
        agent_status = str(runtime_context_value(runtime.context, "agent_status") or "dev").strip() or "dev"
        command_name = str(runtime_context_value(runtime.context, "command_name") or "").strip()
        explicit_source = _infer_source_from_runtime_message(runtime, source=source)
        normalized_source, normalized_skill_name = _normalize_registry_install_request(
            source=explicit_source,
            skill_name=skill_name,
        )
        if not normalized_source:
            return (
                "Error: source is required. Pass an explicit repo source in `source`, "
                'for example `{"source": "https://github.com/MiniMax-AI/skills.git"}`.'
            )
        resolved_skill_name = _candidate_skill_name(
            source=normalized_source,
            skill_name=normalized_skill_name,
        )

        # During `/create-agent`, reuse any visible archived store skill
        # instead of silently reinstalling another same-named copy from the registry.
        if command_name == "create-agent" and resolved_skill_name:
            existing_matches = find_archived_skills_by_name(
                resolved_skill_name,
                agent_status,
            )
            if existing_matches:
                preferred_source = _archive_source_path(existing_matches[0])
                return (
                    f"Error: skill '{resolved_skill_name}' already exists at '{preferred_source}'. "
                    "During `/create-agent`, inspect `/mnt/skills/"
                    f"{preferred_source}/SKILL.md` and attach it with "
                    f"`setup_agent(..., skills=[{{source_path: \"{preferred_source}\"}}])` "
                    "instead of reinstalling it from the registry."
                )

        result = install_registry_skill_to_store(
            source=normalized_source,
            skill_name=normalized_skill_name,
            paths=get_paths(),
        )
        return _format_install_result(result)
    except Exception as exc:
        logger.error("Failed to install registry skill '%s': %s", source, exc, exc_info=True)
        return f"Error: {exc}"
