import re
from dataclasses import dataclass

import yaml

from src.config.paths import Paths, get_paths

_ALLOWED_FRONTMATTER_KEYS = {"name", "kind", "description", "authoring_actions"}
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)
_SAFE_COMMAND_NAME_RE = re.compile(r"^[A-Za-z0-9-]+$")
_TARGET_AGENT_PATTERNS = (
    re.compile(r"(?:名为|名字叫|叫做)\s+([A-Za-z0-9-]+)", re.IGNORECASE),
    re.compile(r"(?:named|called)\s+([A-Za-z0-9-]+)", re.IGNORECASE),
    re.compile(r"(?:agent[_\s-]*name|name)\s*[:=]\s*([A-Za-z0-9-]+)", re.IGNORECASE),
)


@dataclass(frozen=True)
class RuntimeCommandDefinition:
    name: str
    kind: str
    description: str
    authoring_actions: tuple[str, ...]
    template: str


@dataclass(frozen=True)
class RuntimeCommandResolution:
    name: str | None
    kind: str | None
    args: str | None
    authoring_actions: tuple[str, ...]
    target_agent_name: str | None
    prompt: str | None


def _normalize_command_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lstrip("/").lower().replace("_", "-")
    if not normalized or not _SAFE_COMMAND_NAME_RE.match(normalized):
        return None
    return normalized


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_authoring_actions(values: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    for value in values:
        stripped = value.strip()
        if stripped:
            normalized.append(stripped)
    return tuple(normalized)


def _parse_frontmatter(markdown: str) -> tuple[dict[str, object], str]:
    match = _FRONTMATTER_RE.match(markdown)
    if match is None:
        raise ValueError("Command markdown must start with YAML frontmatter.")

    frontmatter_text, body = match.groups()
    payload = yaml.safe_load(frontmatter_text) or {}
    if not isinstance(payload, dict):
        raise ValueError("Command frontmatter must be a YAML mapping.")

    unexpected = set(payload.keys()) - _ALLOWED_FRONTMATTER_KEYS
    if unexpected:
        raise ValueError(
            "Unexpected command frontmatter key(s): " + ", ".join(sorted(unexpected))
        )

    return payload, body.strip()


def parse_slash_command(raw_input: str | None) -> tuple[str, str | None] | None:
    if raw_input is None:
        return None
    trimmed = raw_input.strip()
    if not trimmed.startswith("/"):
        return None

    without_slash = trimmed[1:]
    first_space = without_slash.find(" ")
    if first_space == -1:
        command_name = without_slash
        args = None
    else:
        command_name = without_slash[:first_space]
        args = without_slash[first_space + 1 :].strip() or None

    normalized_name = _normalize_command_name(command_name)
    if normalized_name is None:
        return None
    return normalized_name, args


def infer_target_agent_name(args_text: str | None) -> str | None:
    if args_text is None:
        return None
    for pattern in _TARGET_AGENT_PATTERNS:
        matched = pattern.search(args_text)
        if matched is None:
            continue
        agent_name = matched.group(1).strip()
        if agent_name:
            return agent_name
    return None


def load_common_command_definition(
    command_name: str | None,
    *,
    paths: Paths | None = None,
) -> RuntimeCommandDefinition | None:
    normalized_name = _normalize_command_name(command_name)
    if normalized_name is None:
        return None

    resolved_paths = paths or get_paths()
    command_file = resolved_paths.common_command_file(normalized_name)
    if not command_file.is_file():
        return None

    frontmatter, template = _parse_frontmatter(command_file.read_text(encoding="utf-8"))

    declared_name = _normalize_command_name(str(frontmatter.get("name", normalized_name)))
    if declared_name != normalized_name:
        raise ValueError(
            f"Command frontmatter name mismatch for '{command_file}': expected '{normalized_name}', got '{declared_name}'."
        )

    kind = frontmatter.get("kind")
    if kind not in {"soft", "hard"}:
        raise ValueError(f"Command '{normalized_name}' has invalid kind: {kind!r}")

    description = frontmatter.get("description")
    if not isinstance(description, str) or not description.strip():
        raise ValueError(
            f"Command '{normalized_name}' must declare a non-empty description."
        )

    raw_actions = frontmatter.get("authoring_actions", [])
    if raw_actions is None:
        raw_actions = []
    if not isinstance(raw_actions, list) or not all(
        isinstance(value, str) for value in raw_actions
    ):
        raise ValueError(
            f"Command '{normalized_name}' authoring_actions must be a string list."
        )

    return RuntimeCommandDefinition(
        name=normalized_name,
        kind=kind,
        description=description.strip(),
        authoring_actions=_normalize_authoring_actions(raw_actions),
        template=template,
    )


def render_command_prompt(
    definition: RuntimeCommandDefinition,
    *,
    user_text: str | None,
) -> str:
    return definition.template.replace("{{user_text}}", user_text or "无")


def resolve_runtime_command(
    *,
    command_name: str | None,
    command_kind: str | None,
    command_args: str | None,
    authoring_actions: tuple[str, ...] | list[str],
    original_user_input: str | None,
    target_agent_name: str | None,
    paths: Paths | None = None,
) -> RuntimeCommandResolution:
    resolved_name = _normalize_command_name(command_name)
    resolved_args = _normalize_optional_text(command_args)

    if resolved_name is None:
        parsed = parse_slash_command(original_user_input)
        if parsed is not None:
            resolved_name, parsed_args = parsed
            if resolved_args is None:
                resolved_args = _normalize_optional_text(parsed_args)

    definition = load_common_command_definition(resolved_name, paths=paths)
    resolved_target_agent_name = _normalize_optional_text(target_agent_name)
    if resolved_target_agent_name is None and resolved_name == "create-agent":
        resolved_target_agent_name = infer_target_agent_name(resolved_args)

    return RuntimeCommandResolution(
        name=resolved_name,
        kind=definition.kind if definition is not None else _normalize_optional_text(command_kind),
        args=resolved_args,
        authoring_actions=(
            definition.authoring_actions
            if definition is not None
            else _normalize_authoring_actions(authoring_actions)
        ),
        target_agent_name=resolved_target_agent_name,
        prompt=(
            render_command_prompt(definition, user_text=resolved_args)
            if definition is not None
            else None
        ),
    )
