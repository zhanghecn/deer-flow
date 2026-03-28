from langchain_core.runnables import RunnableConfig
from langgraph_sdk.runtime import ServerRuntime

from .thread_state import ThreadState

__all__ = ["make_lead_agent", "ThreadState"]


async def make_lead_agent(config: RunnableConfig, runtime: ServerRuntime | None = None):
    from .lead_agent import make_lead_agent as _make_lead_agent

    return await _make_lead_agent(config, runtime)
