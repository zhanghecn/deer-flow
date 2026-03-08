"""Configuration and loaders for custom agents."""

import logging
import re
from typing import Any

import yaml
from pydantic import BaseModel

from src.config.paths import AGENTS_ROOT, get_paths

logger = logging.getLogger(__name__)

AGENTS_MD_FILENAME = "AGENTS.md"
# Legacy filename for backward compatibility
_LEGACY_SOUL_FILENAME = "SOUL.md"
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


class AgentConfig(BaseModel):
    """Configuration for a custom agent."""

    name: str
    description: str = ""
    model: str | None = None
    tool_groups: list[str] | None = None
    mcp_servers: list[str] | None = None
    status: str = "dev"


def load_agent_config(name: str | None, status: str = "dev") -> AgentConfig | None:
    """Load the custom or default agent's config from its directory.

    Looks in {base_dir}/agents/{status}/{name}/ first (new layout),
    then falls back to {base_dir}/agents/{name}/ (legacy layout).
    """
    if name is None:
        return None

    if not AGENT_NAME_PATTERN.match(name):
        raise ValueError(f"Invalid agent name '{name}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")

    paths = get_paths()
    # Try new layout: agents/{status}/{name}/
    agent_dir = paths.agent_dir(name, status)
    if not agent_dir.exists():
        # Fallback to legacy layout: agents/{name}/
        agent_dir = paths.agents_dir / name.lower()

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

    known_fields = set(AgentConfig.model_fields.keys())
    data = {k: v for k, v in data.items() if k in known_fields}

    return AgentConfig(**data)


def load_agents_md(agent_name: str | None, status: str = "dev") -> str | None:
    """Read the AGENTS.md (or legacy SOUL.md) file for an agent.

    AGENTS.md defines the agent's personality, values, and behavioral guardrails.
    """
    paths = get_paths()

    if agent_name:
        # Try new layout first
        agent_dir = paths.agent_dir(agent_name, status)
        if not agent_dir.exists():
            # Fallback to legacy layout
            agent_dir = paths.agents_dir / agent_name.lower()
        candidate_dirs = [agent_dir]
    else:
        candidate_dirs = [paths.base_dir, AGENTS_ROOT]

    # Try AGENTS.md first, then legacy SOUL.md
    for agent_dir in candidate_dirs:
        for filename in (AGENTS_MD_FILENAME, _LEGACY_SOUL_FILENAME):
            md_path = agent_dir / filename
            if md_path.exists():
                content = md_path.read_text(encoding="utf-8").strip()
                return content or None

    return None


# Keep backward compatibility alias
load_agent_soul = load_agents_md


def list_custom_agents() -> list[AgentConfig]:
    """Scan the agents directory and return all valid custom agents.

    Scans both new layout (agents/{status}/{name}/) and legacy layout (agents/{name}/).
    """
    agents_dir = get_paths().agents_dir
    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []
    seen_names: set[str] = set()

    # Scan new layout: agents/{status}/{name}/
    for status_dir_name in ("prod", "dev"):
        status_dir = agents_dir / status_dir_name
        if not status_dir.exists():
            continue
        for entry in sorted(status_dir.iterdir()):
            if not entry.is_dir() or (entry / "config.yaml").exists() is False:
                continue
            try:
                agent_cfg = load_agent_config(entry.name, status=status_dir_name)
                if agent_cfg and agent_cfg.name not in seen_names:
                    agents.append(agent_cfg)
                    seen_names.add(agent_cfg.name)
            except Exception as e:
                logger.warning(f"Skipping agent '{entry.name}' ({status_dir_name}): {e}")

    # Scan legacy layout: agents/{name}/ (skip status dirs)
    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir() or entry.name in ("prod", "dev"):
            continue
        if entry.name in seen_names:
            continue
        config_file = entry / "config.yaml"
        if not config_file.exists():
            continue
        try:
            agent_cfg = load_agent_config(entry.name)
            if agent_cfg:
                agents.append(agent_cfg)
                seen_names.add(agent_cfg.name)
        except Exception as e:
            logger.warning(f"Skipping agent '{entry.name}': {e}")

    return agents
