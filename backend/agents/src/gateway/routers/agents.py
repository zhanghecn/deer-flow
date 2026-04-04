"""CRUD API for custom agents."""

import logging
import re
import shutil

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.config.agent_materialization import materialize_agent_definition, publish_agent_definition
from src.config.agent_skill_preservation import load_existing_agent_skill_inputs
from src.config.agents_config import (
    AgentConfig,
    AgentMemoryConfig,
    AgentSkillRef,
    list_custom_agents,
    load_agent_config,
    load_agents_md,
    resolve_authored_agent_dir,
)
from src.config.builtin_agents import LEAD_AGENT_NAME, is_reserved_agent_name
from src.config.paths import get_paths

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["agents"])

AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
VALID_AGENT_STATUSES = {"dev", "prod"}


class AgentSkillResponse(BaseModel):
    """Response model for an agent skill reference."""

    name: str
    category: str | None = Field(default=None, description="Skill source root: system, custom, or legacy store scope during migration")
    source_path: str | None = Field(default=None, description="Archived skill source path such as system/skills/bootstrap")
    materialized_path: str | None = Field(default=None, description="Relative path inside the agent directory")


class AgentResponse(BaseModel):
    """Response model for a custom agent."""

    name: str = Field(..., description="Agent name")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    mcp_servers: list[str] | None = Field(default=None, description="Optional MCP server whitelist")
    status: str | None = Field(default=None, description="Agent status: prod or dev")
    memory: AgentMemoryConfig = Field(default_factory=AgentMemoryConfig, description="Per-agent user-scoped memory policy")
    skills: list[AgentSkillResponse] = Field(default_factory=list, description="Skills copied into the agent directory")
    agents_md: str | None = Field(default=None, description="AGENTS.md content (included on GET /{name})")


class AgentsListResponse(BaseModel):
    """Response model for listing all custom agents."""

    agents: list[AgentResponse]


class AgentCreateRequest(BaseModel):
    """Request body for creating a custom agent."""

    name: str = Field(..., description="Agent name (must match ^[A-Za-z0-9_-]+$, stored as lowercase)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    mcp_servers: list[str] | None = Field(default=None, description="Optional MCP server whitelist")
    memory: AgentMemoryConfig = Field(default_factory=AgentMemoryConfig, description="Per-agent user-scoped memory policy")
    skills: list[str] = Field(default_factory=list, description="Archived store skills to copy into the agent")
    agents_md: str = Field(default="", description="AGENTS.md content — agent personality and behavioral guardrails")


class AgentUpdateRequest(BaseModel):
    """Request body for updating a custom agent."""

    description: str | None = Field(default=None, description="Updated description")
    model: str | None = Field(default=None, description="Updated model override")
    tool_groups: list[str] | None = Field(default=None, description="Updated tool group whitelist")
    mcp_servers: list[str] | None = Field(default=None, description="Updated MCP server whitelist")
    memory: AgentMemoryConfig | None = Field(default=None, description="Updated per-agent user-scoped memory policy")
    skills: list[str] | None = Field(default=None, description="Replacement archived store skills to copy into the agent")
    agents_md: str | None = Field(default=None, description="Updated AGENTS.md content")


class UserProfileResponse(BaseModel):
    """Response model for the global user profile (USER.md)."""

    content: str | None = Field(default=None, description="USER.md content, or null if not yet created")


class UserProfileUpdateRequest(BaseModel):
    """Request body for setting the global user profile."""

    content: str = Field(default="", description="USER.md content — describes the user's background and preferences")


def _validate_agent_name(name: str) -> None:
    """Validate agent name against allowed pattern."""
    if not AGENT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid agent name '{name}'. Must match ^[A-Za-z0-9_-]+$ (letters, digits, underscores, and hyphens only).",
        )


def _normalize_agent_name(name: str) -> str:
    """Normalize agent name to lowercase for filesystem storage."""
    return name.lower()


def _reject_reserved_agent_name(name: str) -> None:
    if is_reserved_agent_name(name):
        raise HTTPException(status_code=409, detail=f"Agent name '{LEAD_AGENT_NAME}' is reserved for the built-in lead agent.")


def _normalize_agent_status(status: str | None, *, default: str = "dev") -> str:
    normalized = (status or default).strip().lower()
    if normalized not in VALID_AGENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid agent status '{status}'. Use one of: dev, prod.")
    return normalized


def _skill_ref_to_response(skill_ref: AgentSkillRef) -> AgentSkillResponse:
    return AgentSkillResponse(
        name=skill_ref.name,
        category=skill_ref.category,
        source_path=skill_ref.source_path,
        materialized_path=skill_ref.materialized_path,
    )


def _agent_config_to_response(agent_cfg: AgentConfig, include_agents_md: bool = False) -> AgentResponse:
    agents_md: str | None = None
    if include_agents_md:
        agents_md = load_agents_md(agent_cfg.name, status=agent_cfg.status) or ""

    return AgentResponse(
        name=agent_cfg.name,
        description=agent_cfg.description,
        model=agent_cfg.model,
        tool_groups=agent_cfg.tool_groups,
        mcp_servers=agent_cfg.mcp_servers,
        status=agent_cfg.status,
        memory=agent_cfg.memory,
        skills=[_skill_ref_to_response(skill_ref) for skill_ref in agent_cfg.skill_refs],
        agents_md=agents_md,
    )


def _agent_exists(paths, name: str) -> bool:
    return (
        resolve_authored_agent_dir(name, "dev", paths=paths) is not None
        or resolve_authored_agent_dir(name, "prod", paths=paths) is not None
    )


@router.get(
    "/agents",
    response_model=AgentsListResponse,
    summary="List Custom Agents",
    description="List all custom agents available in the agents directory.",
)
async def list_agents(status: str | None = Query(default=None, description="Optional status filter: dev or prod")) -> AgentsListResponse:
    """List all custom agents."""
    try:
        normalized_status = _normalize_agent_status(status, default="dev") if status is not None else None
        agents = list_custom_agents()
        if normalized_status is not None:
            agents = [agent for agent in agents if agent.status == normalized_status]
        return AgentsListResponse(agents=[_agent_config_to_response(a) for a in agents])
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list agents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list agents: {str(e)}")


@router.get(
    "/agents/check",
    summary="Check Agent Name",
    description="Validate an agent name and check if it is available (case-insensitive).",
)
async def check_agent_name(name: str) -> dict:
    """Check whether an agent name is valid and not yet taken."""
    _validate_agent_name(name)
    normalized = _normalize_agent_name(name)
    if is_reserved_agent_name(normalized):
        return {"available": False, "name": normalized}
    available = not _agent_exists(get_paths(), normalized)
    return {"available": available, "name": normalized}


@router.get(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Get Custom Agent",
    description="Retrieve details and AGENTS.md content for a specific custom agent.",
)
async def get_agent(
    name: str,
    status: str = Query(default="dev", description="Agent status: dev or prod"),
) -> AgentResponse:
    """Get a specific custom agent by name."""
    _validate_agent_name(name)
    name = _normalize_agent_name(name)
    normalized_status = _normalize_agent_status(status)

    try:
        agent_cfg = load_agent_config(name, status=normalized_status)
        return _agent_config_to_response(agent_cfg, include_agents_md=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' ({normalized_status}) not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get agent '{name}' ({normalized_status}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get agent: {str(e)}")


@router.post(
    "/agents",
    response_model=AgentResponse,
    status_code=201,
    summary="Create Custom Agent",
    description="Create a new dev agent with AGENTS.md and selected copied skills.",
)
async def create_agent_endpoint(request: AgentCreateRequest) -> AgentResponse:
    """Create a new custom agent."""
    _validate_agent_name(request.name)
    normalized_name = _normalize_agent_name(request.name)
    _reject_reserved_agent_name(normalized_name)
    paths = get_paths()

    if _agent_exists(paths, normalized_name):
        raise HTTPException(status_code=409, detail=f"Agent '{normalized_name}' already exists")

    try:
        agent_cfg = materialize_agent_definition(
            name=normalized_name,
            status="dev",
            description=request.description,
            model=request.model,
            tool_groups=request.tool_groups,
            mcp_servers=request.mcp_servers,
            memory=request.memory,
            skill_names=request.skills,
            agents_md=request.agents_md,
            paths=paths,
        )
        logger.info("Created agent '%s' at %s", normalized_name, paths.custom_agent_dir(normalized_name, "dev"))
        return _agent_config_to_response(agent_cfg, include_agents_md=True)
    except ValueError as e:
        logger.error("Failed to create agent '%s': %s", normalized_name, e, exc_info=True)
        if paths.custom_agent_dir(normalized_name, "dev").exists():
            shutil.rmtree(paths.custom_agent_dir(normalized_name, "dev"))
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        if paths.custom_agent_dir(normalized_name, "dev").exists():
            shutil.rmtree(paths.custom_agent_dir(normalized_name, "dev"))
        logger.error(f"Failed to create agent '{request.name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create agent: {str(e)}")


@router.put(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Update Custom Agent",
    description="Update an existing custom agent's manifest, AGENTS.md, and copied skill set.",
)
async def update_agent(
    name: str,
    request: AgentUpdateRequest,
    status: str = Query(default="dev", description="Agent status: dev or prod"),
) -> AgentResponse:
    """Update an existing custom agent."""
    _validate_agent_name(name)
    name = _normalize_agent_name(name)
    _reject_reserved_agent_name(name)
    normalized_status = _normalize_agent_status(status)

    try:
        agent_cfg = load_agent_config(name, status=normalized_status)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' ({normalized_status}) not found")

    try:
        agents_md_content = request.agents_md
        if agents_md_content is None:
            agents_md_content = load_agents_md(name, status=normalized_status) or ""

        paths = get_paths()
        preserved_skill_refs: list[dict[str, str]] | None = None
        preserved_inline_skills: list[dict[str, str]] | None = None
        if request.skills is None:
            # Preserve the agent's current skill contract without degrading copied
            # refs to bare names or dropping agent-owned inline SKILL.md content.
            preserved_skill_refs, preserved_inline_skills = load_existing_agent_skill_inputs(
                agent_name=name,
                agent_status=normalized_status,
                thread_id=None,
                paths=paths,
            )

        updated_cfg = materialize_agent_definition(
            name=name,
            status=normalized_status,
            description=request.description if request.description is not None else agent_cfg.description,
            model=request.model if request.model is not None else agent_cfg.model,
            tool_groups=request.tool_groups if request.tool_groups is not None else agent_cfg.tool_groups,
            mcp_servers=request.mcp_servers if request.mcp_servers is not None else agent_cfg.mcp_servers,
            memory=request.memory if request.memory is not None else agent_cfg.memory,
            skill_names=request.skills,
            skill_refs=preserved_skill_refs,
            inline_skills=preserved_inline_skills,
            agents_md=agents_md_content,
            paths=paths,
        )
        logger.info("Updated agent '%s' (%s)", name, normalized_status)
        return _agent_config_to_response(updated_cfg, include_agents_md=True)
    except ValueError as e:
        logger.error("Failed to update agent '%s' (%s): %s", name, normalized_status, e, exc_info=True)
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update agent '{name}' ({normalized_status}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update agent: {str(e)}")


@router.post(
    "/agents/{name}/publish",
    response_model=AgentResponse,
    summary="Publish Agent",
    description="Publish a dev agent to prod by copying its local archived definition from dev/ to prod/.",
)
async def publish_agent(name: str) -> AgentResponse:
    """Publish a dev agent to prod."""
    _validate_agent_name(name)
    name = _normalize_agent_name(name)
    _reject_reserved_agent_name(name)

    try:
        agent_cfg = publish_agent_definition(name, paths=get_paths())
        logger.info("Published agent '%s' from dev to prod", name)
        return _agent_config_to_response(agent_cfg, include_agents_md=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Dev agent '{name}' not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to publish agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to publish agent: {str(e)}")


@router.get(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Get User Profile",
    description="Read the global USER.md file that is injected into all custom agents.",
)
async def get_user_profile() -> UserProfileResponse:
    """Return the current USER.md content."""
    try:
        user_md_path = get_paths().user_md_file
        if not user_md_path.exists():
            return UserProfileResponse(content=None)
        raw = user_md_path.read_text(encoding="utf-8").strip()
        return UserProfileResponse(content=raw or None)
    except Exception as e:
        logger.error(f"Failed to read user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read user profile: {str(e)}")


@router.put(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Update User Profile",
    description="Write the global USER.md file that is injected into all custom agents.",
)
async def update_user_profile(request: UserProfileUpdateRequest) -> UserProfileResponse:
    """Create or overwrite the global USER.md."""
    try:
        paths = get_paths()
        paths.base_dir.mkdir(parents=True, exist_ok=True)
        paths.user_md_file.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated USER.md at {paths.user_md_file}")
        return UserProfileResponse(content=request.content or None)
    except Exception as e:
        logger.error(f"Failed to update user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update user profile: {str(e)}")


@router.delete(
    "/agents/{name}",
    status_code=204,
    summary="Delete Custom Agent",
    description="Delete a custom agent materialization by status, or remove all statuses when omitted.",
)
async def delete_agent(
    name: str,
    status: str | None = Query(default=None, description="Optional status to delete: dev or prod. Omit to delete all statuses."),
) -> None:
    """Delete a custom agent."""
    _validate_agent_name(name)
    name = _normalize_agent_name(name)
    _reject_reserved_agent_name(name)
    paths = get_paths()

    target_statuses = [_normalize_agent_status(status)] if status is not None else ["dev", "prod"]
    deleted = False

    try:
        for target_status in target_statuses:
            agent_dir = paths.custom_agent_dir(name, target_status)
            if agent_dir.exists():
                shutil.rmtree(agent_dir)
                deleted = True
                logger.info("Deleted agent '%s' from %s", name, agent_dir)

        if not deleted:
            if status is None:
                raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
            raise HTTPException(status_code=404, detail=f"Agent '{name}' ({target_statuses[0]}) not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete agent: {str(e)}")
