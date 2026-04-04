"""Configuration and loaders for custom agents."""

import logging
import re
from pathlib import Path, PurePosixPath
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.config.builtin_agents import is_reserved_agent_name
from src.config.paths import Paths, get_paths

logger = logging.getLogger(__name__)

AGENTS_MD_FILENAME = "AGENTS.md"
SUBAGENTS_FILENAME = "subagents.yaml"
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_SKILL_SOURCE_PREFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("system", ("system", "skills")),
    ("custom", ("custom", "skills")),
    ("store/prod", ("store", "prod")),
    ("store/dev", ("store", "dev")),
)
_RESERVED_SUBAGENT_NAMES = frozenset({"general-purpose"})


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_optional_string_list(value: Any, *, field_name: str) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError(f"Agent field '{field_name}' must be a list of strings.")

    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"Agent field '{field_name}' must be a list of strings.")
        text = item.strip()
        if not text or text in seen:
            continue
        normalized.append(text)
        seen.add(text)

    return normalized or None


def _normalize_required_text(value: str, *, field_name: str) -> str:
    text = str(value).strip()
    if not text:
        raise ValueError(f"Agent field '{field_name}' requires a non-empty string.")
    return text


def _parse_skill_source_path(source_path: str) -> tuple[str, PurePosixPath]:
    path = PurePosixPath(source_path)
    if path.is_absolute() or ".." in path.parts or len(path.parts) < 2:
        raise ValueError(
            "Agent skill source_path must be a safe relative path like "
            "'system/skills/my-skill' or 'custom/skills/my-skill'."
        )

    path_str = path.as_posix()
    for category, prefix_parts in _SKILL_SOURCE_PREFIXES:
        scope_prefix = PurePosixPath(*prefix_parts).as_posix() + "/"
        if not path_str.startswith(scope_prefix):
            continue
        relative_path = PurePosixPath(path_str[len(scope_prefix) :])
        if str(relative_path) == "." or not relative_path.parts:
            raise ValueError("Agent skill source_path must point to a concrete skill directory.")
        return category, relative_path

    valid = ", ".join(PurePosixPath(*prefix_parts).as_posix() for _, prefix_parts in _SKILL_SOURCE_PREFIXES)
    raise ValueError(f"Agent skill source_path must start with one of: {valid}.")


def _derive_materialized_path(source_path: str) -> str:
    _category, relative_path = _parse_skill_source_path(source_path)
    return PurePosixPath("skills", relative_path).as_posix()


def _derive_source_path(category: str, materialized_path: str) -> str:
    normalized_category = category.strip()
    prefix_parts = next((parts for key, parts in _SKILL_SOURCE_PREFIXES if key == normalized_category), None)
    if prefix_parts is None:
        valid = ", ".join(category for category, _ in _SKILL_SOURCE_PREFIXES)
        raise ValueError(f"Agent skill category must be one of: {valid}.")

    path = PurePosixPath(materialized_path)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "skills":
        raise ValueError("Agent skill materialized_path must stay under 'skills/'.")

    relative_path = PurePosixPath(*path.parts[1:])
    if str(relative_path) == ".":
        raise ValueError("Agent skill materialized_path must point to a concrete skill directory.")
    return PurePosixPath(*prefix_parts, relative_path).as_posix()


class AgentConfig(BaseModel):
    """Configuration for a custom agent."""

    name: str
    description: str = ""
    model: str | None = None
    tool_groups: list[str] | None = None
    tool_names: list[str] | None = None
    mcp_servers: list[str] | None = None
    status: str = "dev"
    agents_md_path: str = AGENTS_MD_FILENAME
    skill_refs: list["AgentSkillRef"] = Field(default_factory=list)
    memory: "AgentMemoryConfig" = Field(default_factory=lambda: AgentMemoryConfig())
    subagent_defaults: "AgentSubagentDefaults" = Field(default_factory=lambda: AgentSubagentDefaults())

    @model_validator(mode="after")
    def normalize_manifest_lists(self) -> "AgentConfig":
        self.tool_groups = _normalize_optional_string_list(self.tool_groups, field_name="tool_groups")
        self.tool_names = _normalize_optional_string_list(self.tool_names, field_name="tool_names")
        self.mcp_servers = _normalize_optional_string_list(self.mcp_servers, field_name="mcp_servers")
        return self


class AgentSubagentDefaults(BaseModel):
    """Default runtime policy for the built-in general-purpose subagent."""

    model_config = ConfigDict(extra="forbid")

    general_purpose_enabled: bool = True
    tool_names: list[str] | None = None

    @model_validator(mode="after")
    def normalize_defaults(self) -> "AgentSubagentDefaults":
        self.tool_names = _normalize_optional_string_list(self.tool_names, field_name="subagent_defaults.tool_names")
        return self


class AgentSubagentConfig(BaseModel):
    """Structured configuration for a custom subagent."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    system_prompt: str
    model: str | None = None
    tool_names: list[str] | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def normalize_subagent(self) -> "AgentSubagentConfig":
        self.name = _normalize_required_text(self.name, field_name="subagents[].name")
        if not AGENT_NAME_PATTERN.match(self.name):
            raise ValueError(f"Invalid subagent name '{self.name}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")
        if self.name.lower() in _RESERVED_SUBAGENT_NAMES:
            raise ValueError(f"Subagent name '{self.name}' is reserved.")

        self.description = _normalize_required_text(self.description, field_name=f"subagents[{self.name}].description")
        self.system_prompt = _normalize_required_text(
            self.system_prompt,
            field_name=f"subagents[{self.name}].system_prompt",
        )
        self.model = _normalize_optional_text(self.model)
        self.tool_names = _normalize_optional_string_list(
            self.tool_names,
            field_name=f"subagents[{self.name}].tool_names",
        )
        return self


class AgentSubagentsConfig(BaseModel):
    """Versioned subagent file payload."""

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    subagents: list[AgentSubagentConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_names(self) -> "AgentSubagentsConfig":
        seen: set[str] = set()
        for subagent in self.subagents:
            lowered = subagent.name.lower()
            if lowered in seen:
                raise ValueError(f"Duplicate subagent name '{subagent.name}'.")
            seen.add(lowered)
        return self


class AgentSkillRef(BaseModel):
    """Reference to a skill copied from the OpenAgents skills library."""

    name: str
    category: str | None = None
    source_path: str | None = None
    materialized_path: str | None = None

    @model_validator(mode="after")
    def normalize_reference(self) -> "AgentSkillRef":
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Agent skill ref requires a non-empty name.")

        category = _normalize_optional_text(self.category)
        source_path = _normalize_optional_text(self.source_path)
        materialized_path = _normalize_optional_text(self.materialized_path)

        if source_path is not None:
            derived_category, _relative_path = _parse_skill_source_path(source_path)
            derived_materialized_path = _derive_materialized_path(source_path)
            if category is None:
                category = derived_category
            elif category != derived_category:
                raise ValueError("Agent skill ref category does not match source_path.")

            if materialized_path is None:
                materialized_path = derived_materialized_path
            elif materialized_path != derived_materialized_path:
                raise ValueError("Agent skill ref materialized_path does not match source_path.")
        elif category is not None and materialized_path is not None:
            source_path = _derive_source_path(category, materialized_path)

        self.category = category
        self.source_path = source_path
        self.materialized_path = materialized_path
        return self


class AgentMemoryConfig(BaseModel):
    """Memory policy for a single agent.

    Scope is fixed in code to user + agent (+ status). No alternate scopes are
    supported in manifests or runtime APIs.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    model_name: str | None = None
    debounce_seconds: int = Field(default=30, ge=1, le=300)
    max_facts: int = Field(default=100, ge=10, le=500)
    fact_confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    injection_enabled: bool = True
    max_injection_tokens: int = Field(default=2000, ge=100, le=8000)

    @model_validator(mode="after")
    def validate_enabled_model_name(self) -> "AgentMemoryConfig":
        if self.enabled and not (self.model_name and self.model_name.strip()):
            raise ValueError("Agent memory requires `memory.model_name` when `memory.enabled` is true.")
        return self


AgentConfig.model_rebuild()
AgentSubagentDefaults.model_rebuild()
AgentSubagentConfig.model_rebuild()
AgentSubagentsConfig.model_rebuild()


def serialize_agent_skill_ref(skill_ref: AgentSkillRef) -> dict[str, str]:
    payload = {"name": skill_ref.name}
    if skill_ref.source_path is not None:
        payload["source_path"] = skill_ref.source_path
        return payload

    if skill_ref.category is not None:
        payload["category"] = skill_ref.category
    if skill_ref.materialized_path is not None:
        payload["materialized_path"] = skill_ref.materialized_path
    return payload


def serialize_subagent_defaults(subagent_defaults: AgentSubagentDefaults) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "general_purpose_enabled": subagent_defaults.general_purpose_enabled,
    }
    if subagent_defaults.tool_names is not None:
        payload["tool_names"] = subagent_defaults.tool_names
    return payload


def serialize_agent_subagent(subagent: AgentSubagentConfig) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "description": subagent.description,
        "system_prompt": subagent.system_prompt,
        "enabled": subagent.enabled,
    }
    if subagent.model is not None:
        payload["model"] = subagent.model
    if subagent.tool_names is not None:
        payload["tool_names"] = subagent.tool_names
    return payload


def serialize_agent_subagents_config(config: AgentSubagentsConfig) -> dict[str, Any]:
    return {
        "version": config.version,
        "subagents": {subagent.name: serialize_agent_subagent(subagent) for subagent in config.subagents},
    }


def _resolve_agent_dir(name: str, status: str, paths: Paths | None = None) -> Path:
    resolved = resolve_authored_agent_dir(name, status, paths=paths)
    if resolved is None:
        return (paths or get_paths()).custom_agent_dir(name, status)
    return resolved


def iter_authored_agent_dirs(name: str, status: str, *, paths: Paths | None = None) -> tuple[Path, ...]:
    resolved_paths = paths or get_paths()
    normalized_name = name.lower()
    candidates: list[Path] = []

    custom_agent_dir = getattr(resolved_paths, "custom_agent_dir", None)
    if callable(custom_agent_dir):
        candidates.append(Path(custom_agent_dir(normalized_name, status)))

    system_agent_dir = getattr(resolved_paths, "system_agent_dir", None)
    if callable(system_agent_dir):
        candidates.append(Path(system_agent_dir(normalized_name, status)))

    legacy_agent_dir = getattr(resolved_paths, "agent_dir", None)
    if callable(legacy_agent_dir):
        candidates.append(Path(legacy_agent_dir(normalized_name, status)))

    return tuple(candidates)


def resolve_authored_agent_dir(name: str, status: str, *, paths: Paths | None = None) -> Path | None:
    for candidate in iter_authored_agent_dirs(name, status, paths=paths):
        if candidate.exists():
            return candidate
    return None


def _parse_agent_subagents_payload(raw_data: Any, *, source_path: Path) -> AgentSubagentsConfig:
    if raw_data in (None, {}):
        return AgentSubagentsConfig()
    if not isinstance(raw_data, dict):
        raise ValueError(f"{source_path}: subagents config must be a mapping.")

    raw_version = raw_data.get("version", 1)
    if not isinstance(raw_version, int):
        raise ValueError(f"{source_path}: subagents config field 'version' must be an integer.")

    if "subagents" in raw_data:
        raw_subagents = raw_data.get("subagents") or {}
    else:
        raw_subagents = raw_data

    if not isinstance(raw_subagents, dict):
        raise ValueError(f"{source_path}: subagents config field 'subagents' must be a mapping.")

    parsed_subagents: list[AgentSubagentConfig] = []
    for raw_name, raw_subagent in raw_subagents.items():
        if not isinstance(raw_name, str):
            raise ValueError(f"{source_path}: subagent names must be strings.")
        if not isinstance(raw_subagent, dict):
            raise ValueError(f"{source_path}: subagent '{raw_name}' config must be an object.")

        payload = dict(raw_subagent)
        embedded_name = _normalize_optional_text(payload.get("name"))
        if embedded_name is not None and embedded_name != raw_name.strip():
            raise ValueError(f"{source_path}: subagent key '{raw_name}' does not match embedded name '{embedded_name}'.")
        payload["name"] = raw_name
        parsed_subagents.append(AgentSubagentConfig.model_validate(payload))

    return AgentSubagentsConfig(version=raw_version, subagents=parsed_subagents)


def load_agent_config(name: str | None, status: str = "dev", *, paths: Paths | None = None) -> AgentConfig | None:
    """Load the custom or default agent's config from its directory.

    Agent definitions are stored only in `{base_dir}/agents/{status}/{name}/`.
    """
    if name is None:
        return None

    if not AGENT_NAME_PATTERN.match(name):
        raise ValueError(f"Invalid agent name '{name}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")

    agent_dir = _resolve_agent_dir(name, status, paths)

    config_file = agent_dir / "config.yaml"

    if not agent_dir.exists():
        raise FileNotFoundError(f"Agent directory not found: {agent_dir}")

    if not config_file.exists():
        raise FileNotFoundError(f"Agent config not found: {config_file}")

    try:
        with open(config_file, encoding="utf-8") as f:
            data: dict[str, Any] = yaml.safe_load(f) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"Failed to parse agent config {config_file}: {e}") from e

    if "name" not in data:
        data["name"] = name
    if "status" not in data:
        data["status"] = status
    if "agents_md_path" not in data:
        data["agents_md_path"] = AGENTS_MD_FILENAME

    known_fields = set(AgentConfig.model_fields.keys())
    data = {k: v for k, v in data.items() if k in known_fields}

    return AgentConfig(**data)


def load_agent_subagents(
    agent_name: str | None,
    status: str = "dev",
    *,
    paths: Paths | None = None,
) -> AgentSubagentsConfig:
    """Load structured custom subagent definitions for an agent archive."""
    if agent_name is None:
        return AgentSubagentsConfig()

    source_path = _resolve_agent_dir(agent_name, status, paths) / SUBAGENTS_FILENAME
    if not source_path.exists():
        return AgentSubagentsConfig()

    try:
        with source_path.open(encoding="utf-8") as handle:
            raw_data = yaml.safe_load(handle)
    except yaml.YAMLError as e:
        raise ValueError(f"Failed to parse subagents config {source_path}: {e}") from e

    return _parse_agent_subagents_payload(raw_data, source_path=source_path)


def load_agents_md(agent_name: str | None, status: str = "dev", *, paths: Paths | None = None) -> str | None:
    """Read the AGENTS.md file for an agent.

    AGENTS.md defines the agent's personality, values, and behavioral guardrails.
    """
    if agent_name is None:
        return None

    agent_dir = _resolve_agent_dir(agent_name, status, paths)
    try:
        agent_config = load_agent_config(agent_name, status, paths=paths)
    except FileNotFoundError:
        agent_config = None

    candidate_path = agent_dir / AGENTS_MD_FILENAME
    if agent_config is not None:
        configured_path = Path(agent_config.agents_md_path)
        candidate_path = configured_path if configured_path.is_absolute() else agent_dir / configured_path

    if not candidate_path.exists():
        return None

    content = candidate_path.read_text(encoding="utf-8").strip()
    return content or None


def list_custom_agents() -> list[AgentConfig]:
    """Scan the agents directory and return all valid custom agents.

    Scans the writable custom-authored agent roots for both `dev` and `prod`.
    """
    paths = get_paths()
    agents_dir = paths.custom_agents_dir
    legacy_agents_dir = paths.agents_dir
    if not agents_dir.exists() and not legacy_agents_dir.exists():
        return []

    agents: list[AgentConfig] = []
    seen_agents: set[tuple[str, str]] = set()

    for status_dir_name in ("prod", "dev"):
        for status_dir in (agents_dir / status_dir_name, legacy_agents_dir / status_dir_name):
            if not status_dir.exists():
                continue
            for entry in sorted(status_dir.iterdir()):
                if not entry.is_dir() or not (entry / "config.yaml").exists():
                    continue
                if is_reserved_agent_name(entry.name):
                    continue
                try:
                    agent_cfg = load_agent_config(entry.name, status=status_dir_name, paths=paths)
                    key = (agent_cfg.name, agent_cfg.status) if agent_cfg else None
                    if agent_cfg and key not in seen_agents:
                        agents.append(agent_cfg)
                        assert key is not None
                        seen_agents.add(key)
                except Exception as e:
                    logger.warning(f"Skipping agent '{entry.name}' ({status_dir_name}): {e}")

    return sorted(agents, key=lambda agent: (agent.name, agent.status))
