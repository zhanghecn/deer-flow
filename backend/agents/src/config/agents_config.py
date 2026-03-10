"""Configuration and loaders for custom agents."""

import logging
import re
from pathlib import Path, PurePosixPath
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.config.builtin_agents import is_reserved_agent_name
from src.config.paths import get_paths

logger = logging.getLogger(__name__)

AGENTS_MD_FILENAME = "AGENTS.md"
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_SKILL_SOURCE_CATEGORIES = frozenset({"public", "custom"})


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _parse_skill_source_path(source_path: str) -> tuple[str, PurePosixPath]:
    path = PurePosixPath(source_path)
    if path.is_absolute() or ".." in path.parts or len(path.parts) < 2:
        raise ValueError("Agent skill source_path must be a safe relative path like 'public/my-skill'.")

    category = path.parts[0]
    if category not in _SKILL_SOURCE_CATEGORIES:
        valid = ", ".join(sorted(_SKILL_SOURCE_CATEGORIES))
        raise ValueError(f"Agent skill source_path must start with one of: {valid}.")

    return category, PurePosixPath(*path.parts[1:])


def _derive_materialized_path(source_path: str) -> str:
    _category, relative_path = _parse_skill_source_path(source_path)
    return PurePosixPath("skills", relative_path).as_posix()


def _derive_source_path(category: str, materialized_path: str) -> str:
    normalized_category = category.strip()
    if normalized_category not in _SKILL_SOURCE_CATEGORIES:
        valid = ", ".join(sorted(_SKILL_SOURCE_CATEGORIES))
        raise ValueError(f"Agent skill category must be one of: {valid}.")

    path = PurePosixPath(materialized_path)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "skills":
        raise ValueError("Agent skill materialized_path must stay under 'skills/'.")

    relative_path = PurePosixPath(*path.parts[1:])
    if str(relative_path) == ".":
        raise ValueError("Agent skill materialized_path must point to a concrete skill directory.")
    return PurePosixPath(normalized_category, relative_path).as_posix()


class AgentConfig(BaseModel):
    """Configuration for a custom agent."""

    name: str
    description: str = ""
    model: str | None = None
    tool_groups: list[str] | None = None
    mcp_servers: list[str] | None = None
    status: str = "dev"
    agents_md_path: str = AGENTS_MD_FILENAME
    skill_refs: list["AgentSkillRef"] = Field(default_factory=list)
    memory: "AgentMemoryConfig" = Field(default_factory=lambda: AgentMemoryConfig())


class AgentSkillRef(BaseModel):
    """Reference to a skill copied from the shared skills library."""

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


def _resolve_agent_dir(name: str, status: str) -> Path:
    return get_paths().agent_dir(name, status)


def load_agent_config(name: str | None, status: str = "dev") -> AgentConfig | None:
    """Load the custom or default agent's config from its directory.

    Agent definitions are stored only in `{base_dir}/agents/{status}/{name}/`.
    """
    if name is None:
        return None

    if not AGENT_NAME_PATTERN.match(name):
        raise ValueError(f"Invalid agent name '{name}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")

    agent_dir = _resolve_agent_dir(name, status)

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


def load_agents_md(agent_name: str | None, status: str = "dev") -> str | None:
    """Read the AGENTS.md file for an agent.

    AGENTS.md defines the agent's personality, values, and behavioral guardrails.
    """
    if agent_name is None:
        return None

    agent_dir = _resolve_agent_dir(agent_name, status)
    try:
        agent_config = load_agent_config(agent_name, status)
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

    Scans `agents/{status}/{name}/` for both `dev` and `prod`.
    """
    agents_dir = get_paths().agents_dir
    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []
    seen_agents: set[tuple[str, str]] = set()

    for status_dir_name in ("prod", "dev"):
        status_dir = agents_dir / status_dir_name
        if not status_dir.exists():
            continue
        for entry in sorted(status_dir.iterdir()):
            if not entry.is_dir() or not (entry / "config.yaml").exists():
                continue
            if is_reserved_agent_name(entry.name):
                continue
            try:
                agent_cfg = load_agent_config(entry.name, status=status_dir_name)
                key = (agent_cfg.name, agent_cfg.status) if agent_cfg else None
                if agent_cfg and key not in seen_agents:
                    agents.append(agent_cfg)
                    assert key is not None
                    seen_agents.add(key)
            except Exception as e:
                logger.warning(f"Skipping agent '{entry.name}' ({status_dir_name}): {e}")

    return sorted(agents, key=lambda agent: (agent.name, agent.status))
