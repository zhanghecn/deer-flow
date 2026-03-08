from typing import Annotated

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware

from src.agents.thread_state import merge_artifacts


class ArtifactsMiddlewareState(AgentState):
    """State schema for artifacts produced by `present_files`."""

    artifacts: Annotated[list[str], merge_artifacts]


class ArtifactsMiddleware(AgentMiddleware[ArtifactsMiddlewareState]):
    """Register artifacts in the graph state so `present_files` updates persist."""

    state_schema = ArtifactsMiddlewareState
