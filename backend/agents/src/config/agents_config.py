"""Configuration and loaders for custom agents."""

import logging
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from src.config.builtin_agents import is_reserved_agent_name
from src.config.paths import get_paths

logger = logging.getLogger(__name__)

AGENTS_MD_FILENAME = "AGENTS.md"
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


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


class AgentSkillRef(BaseModel):
    """Reference to a skill copied from the shared skills library."""

    name: str
    category: str | None = None
    source_path: str | None = None
    materialized_path: str | None = None


AgentConfig.model_rebuild()


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
