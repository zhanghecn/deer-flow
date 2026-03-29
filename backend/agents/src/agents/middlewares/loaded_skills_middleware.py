from __future__ import annotations

from typing import Annotated, NotRequired, TypedDict, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import PrivateStateAttr
from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime


class LoadedSkillEntry(TypedDict):
    """One skill materialized through the canonical `skill` tool in this run."""

    name: str
    runtime_path: str
    source_path: str | None


class LoadedSkillsState(AgentState):
    """Private per-run state for the `skill` tool.

    We reset this list at the start of every run so `setup_agent` only inherits
    skills that were explicitly loaded in the current create-agent workflow.
    """

    loaded_skills: NotRequired[Annotated[list[LoadedSkillEntry], PrivateStateAttr]]


class LoadedSkillsStateUpdate(TypedDict):
    loaded_skills: list[LoadedSkillEntry]


class LoadedSkillsMiddleware(AgentMiddleware[LoadedSkillsState]):
    """Reset turn-local loaded-skill state before each agent run."""

    state_schema = LoadedSkillsState

    @override
    def before_agent(
        self,
        state: LoadedSkillsState,
        runtime: Runtime,
        config: RunnableConfig,
    ) -> LoadedSkillsStateUpdate:
        del state, runtime, config
        return {"loaded_skills": []}

    @override
    async def abefore_agent(
        self,
        state: LoadedSkillsState,
        runtime: Runtime,
        config: RunnableConfig,
    ) -> LoadedSkillsStateUpdate:
        del state, runtime, config
        return {"loaded_skills": []}
