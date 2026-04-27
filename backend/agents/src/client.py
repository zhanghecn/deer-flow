"""OpenAgentsClient — Embedded Python client for OpenAgents agent system.

Provides direct programmatic access to OpenAgents's agent capabilities
without requiring LangGraph Server or Gateway API processes.

Usage:
    from src.client import OpenAgentsClient

    client = OpenAgentsClient()
    response = client.chat("Analyze this paper for me", thread_id="my-thread")
    print(response)

    # Streaming
    for event in client.stream("hello"):
        print(event)
"""

import asyncio
import json
import logging
import mimetypes
import re
import shutil
import tempfile
import uuid
import zipfile
from collections.abc import Generator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from deepagents import create_deep_agent
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from src.agents.lead_agent.agent import (
    LeadAgentRuntimeContext,
    _build_openagents_middlewares,
    build_backend,
)
from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.lead_agent.subagents import load_subagent_specs
from src.config.agents_config import AgentConfig, load_agent_config
from src.config.app_config import get_app_config, reload_app_config
from src.config.builtin_agents import LEAD_AGENT_NAME
from src.config.extensions_config import (
    ExtensionsConfig,
    SkillStateConfig,
    get_extensions_config,
    reload_extensions_config,
)
from src.config.mcp_profile_migration import migrate_legacy_mcp_profile_layout
from src.config.paths import get_paths
from src.mcp.library import load_mcp_profile, resolve_mcp_profile_file, write_mcp_profile
from src.config.runtime_defaults import DEFAULT_SUBAGENT_ENABLED
from src.config.runtime_limits import DEFAULT_AGENT_RECURSION_LIMIT
from src.models import create_chat_model
from src.query_engine import CanonicalQueryEngine, CanonicalRunEvent

logger = logging.getLogger(__name__)


@dataclass
class StreamEvent:
    """A single event from the streaming agent response.

    Event types align with the LangGraph SSE protocol:
        - ``"values"``: Full state snapshot (title, messages, artifacts).
        - ``"messages-tuple"``: Per-message update (AI text, tool calls, tool results).
        - ``"end"``: Stream finished.

    Attributes:
        type: Event type.
        data: Event payload. Contents vary by type.
    """

    type: str
    data: dict[str, Any] = field(default_factory=dict)


class OpenAgentsClient:
    """Embedded Python client for OpenAgents agent system.

    Provides direct programmatic access to OpenAgents's agent capabilities
    without requiring LangGraph Server or Gateway API processes.

    Note:
        Multi-turn conversations require a ``checkpointer``. Without one,
        each ``stream()`` / ``chat()`` call is stateless — ``thread_id``
        is only used for file isolation (uploads / artifacts).

        The system prompt (including date, memory, and skills context) is
        generated when the internal agent is first created and cached until
        the configuration key changes. Call :meth:`reset_agent` to force
        a refresh in long-running processes.

    Example::

        from src.client import OpenAgentsClient

        client = OpenAgentsClient()

        # Simple one-shot
        print(client.chat("hello"))

        # Streaming
        for event in client.stream("hello"):
            print(event.type, event.data)

        # Configuration queries
        print(client.list_models())
        print(client.list_skills())
    """

    def __init__(
        self,
        config_path: str | None = None,
        checkpointer=None,
        *,
        model_name: str | None = None,
        thinking_enabled: bool = True,
        subagent_enabled: bool = DEFAULT_SUBAGENT_ENABLED,
        plan_mode: bool = False,
    ):
        """Initialize the client.

        Loads configuration but defers agent creation to first use.

        Args:
            config_path: Path to config.yaml. Uses default resolution if None.
            checkpointer: LangGraph checkpointer instance for state persistence.
                Required for multi-turn conversations on the same thread_id.
                Without a checkpointer, each call is stateless.
            model_name: Override the default model name from config.
            thinking_enabled: Enable model's extended thinking.
            subagent_enabled: Enable subagent delegation.
            plan_mode: Enable TodoList middleware for plan mode.
        """
        if config_path is not None:
            reload_app_config(config_path)
        self._app_config = get_app_config()
        migrate_legacy_mcp_profile_layout(paths=get_paths())

        self._checkpointer = checkpointer
        self._model_name = model_name
        self._thinking_enabled = thinking_enabled
        self._subagent_enabled = subagent_enabled
        self._plan_mode = plan_mode

        # Lazy agent — created on first call, recreated when config changes.
        self._agent = None
        self._agent_config_key: tuple | None = None

    def reset_agent(self) -> None:
        """Force the internal agent to be recreated on the next call.

        Use this after external changes (e.g. memory updates, skill
        installations) that should be reflected in the system prompt
        or tool set.
        """
        self._agent = None
        self._agent_config_key = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _atomic_write_json(path: Path, data: dict) -> None:
        """Write JSON to *path* atomically (temp file + replace)."""
        fd = tempfile.NamedTemporaryFile(
            mode="w",
            dir=path.parent,
            suffix=".tmp",
            delete=False,
        )
        try:
            json.dump(data, fd, indent=2)
            fd.close()
            Path(fd.name).replace(path)
        except BaseException:
            fd.close()
            Path(fd.name).unlink(missing_ok=True)
            raise

    def _get_runnable_config(self, thread_id: str, **overrides) -> RunnableConfig:
        """Build a RunnableConfig for agent invocation."""
        configurable = {
            "thread_id": thread_id,
            "model_name": overrides.get("model_name", self._model_name),
            "thinking_enabled": overrides.get("thinking_enabled", self._thinking_enabled),
            "is_plan_mode": overrides.get("plan_mode", self._plan_mode),
            "subagent_enabled": overrides.get("subagent_enabled", self._subagent_enabled),
            "max_concurrent_subagents": overrides.get("max_concurrent_subagents", 3),
            "user_id": overrides.get("user_id"),
            "agent_name": overrides.get("agent_name"),
            "agent_status": overrides.get("agent_status"),
            "execution_backend": overrides.get("execution_backend"),
            "remote_session_id": overrides.get("remote_session_id"),
        }
        # Keep the embedded client aligned with the server-owned step budget
        # instead of exposing a per-call recursion override.
        return RunnableConfig(
            configurable=configurable,
            recursion_limit=DEFAULT_AGENT_RECURSION_LIMIT,
        )

    @staticmethod
    def _build_agent_cache_key(cfg: dict[str, Any]) -> tuple[Any, ...]:
        """Return the cache key for the compiled Deep Agent graph.

        The graph closes over thread-scoped backend state plus prompt inputs such
        as `user_id` and `max_concurrent_subagents`. Reusing the same compiled
        graph across different values would leak the wrong workspace or prompt.
        """

        return (
            cfg.get("thread_id"),
            cfg.get("user_id"),
            cfg.get("model_name"),
            cfg.get("thinking_enabled"),
            cfg.get("is_plan_mode"),
            cfg.get("subagent_enabled"),
            cfg.get("max_concurrent_subagents", 3),
        )

    def _create_embedded_lead_agent(
        self,
        *,
        effective_model_name: str,
        model_config: Any,
        thinking_enabled: bool,
        subagent_enabled: bool,
        max_concurrent_subagents: int,
        thread_id: str,
        user_id: str | None,
    ):
        """Assemble the embedded lead-agent graph.

        This mirrors the server-side lead-agent defaults closely so embedded
        callers exercise the same skills, middleware, approval policy, and
        runtime context contract as the HTTP/SSE runtime.
        """

        backend = build_backend(thread_id, agent_name=LEAD_AGENT_NAME)
        tools = self._get_tools(
            model_name=effective_model_name,
            model_supports_vision=model_config.supports_vision,
        )
        try:
            lead_agent_config = load_agent_config(LEAD_AGENT_NAME, status="dev")
        except FileNotFoundError:
            lead_agent_config = AgentConfig(name=LEAD_AGENT_NAME, status="dev")

        loaded_subagents = (
            load_subagent_specs(
                tools,
                agent_config=lead_agent_config,
                agent_status="dev",
                model_name=effective_model_name,
                model_supports_vision=model_config.supports_vision,
            )
            if subagent_enabled
            else None
        )
        create_kwargs: dict[str, Any] = {
            "model": create_chat_model(
                name=effective_model_name,
                thinking_enabled=thinking_enabled,
                runtime_model_config=model_config,
            ),
            "tools": tools,
            "system_prompt": apply_prompt_template(
                user_id=user_id,
                agent_name=LEAD_AGENT_NAME,
                agent_status="dev",
                memory_config=lead_agent_config.memory if lead_agent_config is not None else None,
                agent_config=lead_agent_config,
            ),
            "middleware": _build_openagents_middlewares(model_config),
            "subagents": loaded_subagents.custom_subagents if loaded_subagents is not None else None,
            "general_purpose_tools": loaded_subagents.general_purpose_tools if loaded_subagents is not None else tools,
            "general_purpose_enabled": loaded_subagents.general_purpose_enabled if loaded_subagents is not None else False,
            "backend": backend,
            "context_schema": LeadAgentRuntimeContext,
            "checkpointer": self._checkpointer,
            "name": LEAD_AGENT_NAME,
        }

        return create_deep_agent(**create_kwargs)

    def _ensure_agent(self, config: RunnableConfig):
        """Create (or recreate) the agent when graph-defining inputs change."""
        cfg = config.get("configurable", {})
        key = self._build_agent_cache_key(cfg)
        if self._agent is not None and self._agent_config_key == key:
            return

        thinking_enabled = cfg.get("thinking_enabled", True)
        model_name = cfg.get("model_name")
        subagent_enabled = cfg.get(
            "subagent_enabled",
            DEFAULT_SUBAGENT_ENABLED,
        )
        max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
        thread_id = cfg.get("thread_id", "_default")
        effective_model_name = model_name
        if effective_model_name is None and self._app_config.models:
            effective_model_name = self._app_config.models[0].name
        if effective_model_name is None:
            raise ValueError("No model configured for OpenAgentsClient runtime.")
        model_config = self._app_config.get_model_config(effective_model_name)
        if model_config is None:
            raise ValueError(f"Model '{effective_model_name}' is not available in config.")

        user_id = cfg.get("user_id")
        self._agent = self._create_embedded_lead_agent(
            effective_model_name=effective_model_name,
            model_config=model_config,
            thinking_enabled=thinking_enabled,
            subagent_enabled=subagent_enabled,
            max_concurrent_subagents=max_concurrent_subagents,
            thread_id=thread_id,
            user_id=user_id,
        )
        self._agent_config_key = key
        logger.info(
            "Agent created: model=%s, thinking=%s, thread_id=%s",
            effective_model_name,
            thinking_enabled,
            thread_id,
        )

    @staticmethod
    def _get_tools(*, model_name: str | None, model_supports_vision: bool):
        """Lazy import to avoid circular dependency at module level."""
        from src.tools import get_available_tools

        return get_available_tools(
            model_name=model_name,
            model_supports_vision=model_supports_vision,
        )

    @staticmethod
    def _serialize_message(msg) -> dict:
        """Serialize a LangChain message to a plain dict for values events."""
        if isinstance(msg, AIMessage):
            d: dict[str, Any] = {"type": "ai", "content": msg.content, "id": getattr(msg, "id", None)}
            if msg.tool_calls:
                d["tool_calls"] = [{"name": tc["name"], "args": tc["args"], "id": tc.get("id")} for tc in msg.tool_calls]
            return d
        if isinstance(msg, ToolMessage):
            return {
                "type": "tool",
                "content": msg.content if isinstance(msg.content, str) else str(msg.content),
                "name": getattr(msg, "name", None),
                "tool_call_id": getattr(msg, "tool_call_id", None),
                "id": getattr(msg, "id", None),
            }
        if isinstance(msg, HumanMessage):
            return {"type": "human", "content": msg.content, "id": getattr(msg, "id", None)}
        if isinstance(msg, SystemMessage):
            return {"type": "system", "content": msg.content, "id": getattr(msg, "id", None)}
        return {"type": "unknown", "content": str(msg), "id": getattr(msg, "id", None)}

    @staticmethod
    def _extract_text(content) -> str:
        """Extract plain text from AIMessage content (str or list of blocks)."""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block["text"])
            return "\n".join(parts) if parts else ""
        return str(content)

    def _iter_legacy_message_events(
        self,
        messages: list[Any],
        *,
        seen_ids: set[str],
    ) -> Generator[StreamEvent, None, None]:
        """Project LangGraph message objects into the legacy embedded event API.

        The embedded client still exposes `messages-tuple` and `values` so
        older callers remain compatible while the runtime migrates toward the
        canonical run-event contract. Keep that projection in one place instead
        of duplicating the same AI/tool branching for every chunk shape.
        """

        for message in messages:
            message_id = getattr(message, "id", None)
            if message_id and message_id in seen_ids:
                continue
            if message_id:
                seen_ids.add(message_id)

            if isinstance(message, AIMessage):
                if message.tool_calls:
                    yield StreamEvent(
                        type="messages-tuple",
                        data={
                            "type": "ai",
                            "content": "",
                            "id": message_id,
                            "tool_calls": [
                                {
                                    "name": tool_call["name"],
                                    "args": tool_call["args"],
                                    "id": tool_call.get("id"),
                                }
                                for tool_call in message.tool_calls
                            ],
                        },
                    )

                text = self._extract_text(message.content)
                if text:
                    yield StreamEvent(
                        type="messages-tuple",
                        data={"type": "ai", "content": text, "id": message_id},
                    )
                continue

            if isinstance(message, ToolMessage):
                yield StreamEvent(
                    type="messages-tuple",
                    data={
                        "type": "tool",
                        "content": (
                            message.content
                            if isinstance(message.content, str)
                            else str(message.content)
                        ),
                        "name": getattr(message, "name", None),
                        "tool_call_id": getattr(message, "tool_call_id", None),
                        "id": message_id,
                    },
                )

    def _build_values_event(self, payload: dict[str, Any]) -> StreamEvent:
        """Return the snapshot-style values event for one runtime chunk."""

        messages = payload.get("messages", [])
        return StreamEvent(
            type="values",
            data={
                "title": payload.get("title"),
                "messages": [self._serialize_message(message) for message in messages],
                "artifacts": payload.get("artifacts", []),
            },
        )

    # ------------------------------------------------------------------
    # Public API — conversation
    # ------------------------------------------------------------------

    def stream(
        self,
        message: str,
        *,
        thread_id: str | None = None,
        **kwargs,
    ) -> Generator[StreamEvent, None, None]:
        """Stream a conversation turn, yielding events incrementally.

        Each call sends one user message and yields events until the agent
        finishes its turn. A ``checkpointer`` must be provided at init time
        for multi-turn context to be preserved across calls.

        Event types align with the LangGraph SSE protocol as closely as the
        embedded runtime allows, including custom runtime events such as
        ``execution_event``. This keeps the embedded client on the same
        event-contract path as the HTTP runtime instead of hiding runtime
        custom events behind a simplified local-only adapter.

        Args:
            message: User message text.
            thread_id: Thread ID for conversation context. Auto-generated if None.
            **kwargs: Override client defaults (model_name, thinking_enabled,
                plan_mode, subagent_enabled, recursion_limit).

        Yields:
            StreamEvent with one of:
            - type="values"          data={"title": str|None, "messages": [...], "artifacts": [...]}
            - type="messages-tuple"  data={"type": "ai", "content": str, "id": str}
            - type="messages-tuple"  data={"type": "ai", "content": "", "id": str, "tool_calls": [...]}
            - type="messages-tuple"  data={"type": "tool", "content": str, "name": str, "tool_call_id": str, "id": str}
            - type="execution_event" data={...}
            - type="task_running"    data={...}
            - type="interrupts"      data={"__interrupt__": [...]}
            - type="end"             data={}
        """
        if thread_id is None:
            thread_id = str(uuid.uuid4())

        config = self._get_runnable_config(thread_id, **kwargs)
        self._ensure_agent(config)

        state: dict[str, Any] = {"messages": [HumanMessage(content=message)]}
        context = {"thread_id": thread_id}

        seen_ids: set[str] = set()

        # Request values/custom/updates together so embedded callers can see the
        # same runtime-authored event families that the HTTP runtime exposes.
        # The legacy `messages-tuple` compatibility events are still projected
        # from the values snapshots below so current consumers keep working.
        for raw_chunk in self._agent.stream(
            state,
            config=config,
            context=context,
            stream_mode=["values", "updates", "custom"],
        ):
            if isinstance(raw_chunk, tuple) and len(raw_chunk) == 3:
                namespace, stream_mode, payload = raw_chunk
                # Keep the top-level client contract focused on the main run.
                # Sub-agent output will move to explicit canonical events later
                # instead of leaking nested raw stream namespaces now.
                if namespace:
                    continue

                if stream_mode == "values" and isinstance(payload, dict):
                    messages = payload.get("messages", [])
                    yield from self._iter_legacy_message_events(
                        messages,
                        seen_ids=seen_ids,
                    )
                    yield self._build_values_event(payload)
                    continue

                if stream_mode == "custom" and isinstance(payload, dict):
                    custom_type = str(payload.get("type") or "custom").strip() or "custom"
                    yield StreamEvent(type=custom_type, data=payload)
                    continue

                if stream_mode == "updates" and isinstance(payload, dict):
                    if "__interrupt__" in payload:
                        yield StreamEvent(type="interrupts", data=payload)
                    else:
                        yield StreamEvent(type="updates", data=payload)
                    continue

            elif isinstance(raw_chunk, dict):
                messages = raw_chunk.get("messages", [])
                yield from self._iter_legacy_message_events(
                    messages,
                    seen_ids=seen_ids,
                )
                yield self._build_values_event(raw_chunk)

        yield StreamEvent(type="end", data={})

    def stream_run_events(
        self,
        message: str,
        *,
        thread_id: str | None = None,
        response_id: str | None = None,
        **kwargs,
    ) -> Generator[CanonicalRunEvent, None, None]:
        """Stream canonical run events from the current embedded runtime.

        This is the first QueryEngine-style SDK lane: it consumes the embedded
        stream event contract and yields a smaller canonical run-event sequence
        for SDK or frontend adapters that should not depend on raw stream event
        families directly.
        """

        query_engine = CanonicalQueryEngine(response_id=response_id)
        try:
            for event in self.stream(message, thread_id=thread_id, **kwargs):
                yield from query_engine.consume_stream_event(event)
        except Exception as exc:
            yield query_engine.fail(exc)
            raise

    def chat(self, message: str, *, thread_id: str | None = None, **kwargs) -> str:
        """Send a message and return the final text response.

        Convenience wrapper around :meth:`stream` that returns only the
        **last** AI text from ``messages-tuple`` events. If the agent emits
        multiple text segments in one turn, intermediate segments are
        discarded. Use :meth:`stream` directly to capture all events.

        Args:
            message: User message text.
            thread_id: Thread ID for conversation context. Auto-generated if None.
            **kwargs: Override client defaults (same as stream()).

        Returns:
            The last AI message text, or empty string if no response.
        """
        last_text = ""
        for event in self.stream(message, thread_id=thread_id, **kwargs):
            if event.type == "messages-tuple" and event.data.get("type") == "ai":
                content = event.data.get("content", "")
                if content:
                    last_text = content
        return last_text

    # ------------------------------------------------------------------
    # Public API — configuration queries
    # ------------------------------------------------------------------

    def list_models(self) -> dict:
        """List available models from configuration.

        Returns:
            Dict with "models" key containing list of model info dicts,
            matching the Gateway API ``ModelsListResponse`` schema.
        """
        return {
            "models": [
                {
                    "name": model.name,
                    "display_name": getattr(model, "display_name", None),
                    "description": getattr(model, "description", None),
                    "supports_thinking": getattr(model, "supports_thinking", False),
                    "supports_effort": getattr(model, "supports_effort", False),
                }
                for model in self._app_config.models
            ]
        }

    def list_skills(self, enabled_only: bool = False) -> dict:
        """List available skills.

        Args:
            enabled_only: If True, only return enabled skills.

        Returns:
            Dict with "skills" key containing list of skill info dicts,
            matching the Gateway API ``SkillsListResponse`` schema.
        """
        from src.skills.loader import load_skills

        return {
            "skills": [
                {
                    "name": s.name,
                    "description": s.description,
                    "license": s.license,
                    "category": s.category,
                    "enabled": s.enabled,
                }
                for s in load_skills(enabled_only=enabled_only)
            ]
        }

    def get_memory(self, *, user_id: str, agent_name: str, agent_status: str = "dev") -> dict:
        """Get current memory data.

        Returns:
            Memory data dict (see src/agents/memory/updater.py for structure).
        """
        from src.agents.memory.updater import get_memory_data

        return get_memory_data(
            user_id=user_id,
            agent_name=agent_name,
            agent_status=agent_status,
        )

    def get_model(self, name: str) -> dict | None:
        """Get a specific model's configuration by name.

        Args:
            name: Model name.

        Returns:
            Model info dict matching the Gateway API ``ModelResponse``
            schema, or None if not found.
        """
        model = self._app_config.get_model_config(name)
        if model is None:
            return None
        return {
            "name": model.name,
            "display_name": getattr(model, "display_name", None),
            "description": getattr(model, "description", None),
            "supports_thinking": getattr(model, "supports_thinking", False),
            "supports_effort": getattr(model, "supports_effort", False),
        }

    # ------------------------------------------------------------------
    # Public API — MCP configuration
    # ------------------------------------------------------------------

    def get_mcp_config(self) -> dict:
        """Get MCP server configurations.

        Returns:
            Dict with "mcp_servers" key mapping server name to config,
            matching the Gateway API ``McpConfigResponse`` schema.
        """
        config = get_extensions_config()
        return {"mcp_servers": {name: server.model_dump() for name, server in config.mcp_servers.items()}}

    def update_mcp_config(self, mcp_servers: dict[str, dict]) -> dict:
        """Update MCP server configurations.

        Writes to extensions_config.json and reloads the cache.

        Args:
            mcp_servers: Dict mapping server name to config dict.
                Each value should contain keys like enabled, type, command, args, env, url, etc.

        Returns:
            Dict with "mcp_servers" key, matching the Gateway API
            ``McpConfigResponse`` schema.

        Raises:
            OSError: If the config file cannot be written.
        """
        config_path = ExtensionsConfig.resolve_config_path()
        if config_path is None:
            raise FileNotFoundError("Cannot locate extensions_config.json. Set OPENAGENTS_EXTENSIONS_CONFIG_PATH or ensure it exists in the project root.")

        current_config = get_extensions_config()

        config_data = {
            "mcpServers": mcp_servers,
            "skills": {name: {"enabled": skill.enabled} for name, skill in current_config.skills.items()},
        }

        self._atomic_write_json(config_path, config_data)

        self._agent = None
        reloaded = reload_extensions_config()
        return {"mcp_servers": {name: server.model_dump() for name, server in reloaded.mcp_servers.items()}}

    # ------------------------------------------------------------------
    # Public API — MCP profile library
    # ------------------------------------------------------------------

    def list_mcp_profiles(self) -> dict:
        """List reusable MCP library items.

        Returns:
            Dict with `profiles` array matching the Gateway MCP profile list
            shape.
        """
        paths = get_paths()
        profiles: list[dict[str, Any]] = []
        root = paths.mcp_profiles_dir
        if not root.exists():
            return {"profiles": profiles}
        for profile_file in sorted(root.rglob("*.json")):
            relative_path = profile_file.relative_to(root).as_posix()
            source_path = f"mcp-profiles/{relative_path}"
            server_name, _config = load_mcp_profile(source_path, paths=paths)
            with open(profile_file, encoding="utf-8") as handle:
                payload = json.load(handle)
            profiles.append(
                {
                    "name": profile_file.stem,
                    "server_name": server_name,
                    "category": "global",
                    "source_path": source_path,
                    "can_edit": True,
                    "config_json": payload,
                }
            )
        return {"profiles": profiles}

    def get_mcp_profile(self, name: str, source_path: str | None = None) -> dict:
        """Get one MCP library item by source path or visible name."""
        normalized_source_path = str(source_path or "").strip()
        if normalized_source_path:
            resolved_file = resolve_mcp_profile_file(normalized_source_path, paths=get_paths())
            with open(resolved_file, encoding="utf-8") as handle:
                payload = json.load(handle)
            server_name, _config = load_mcp_profile(normalized_source_path, paths=get_paths())
            return {
                "name": resolved_file.stem,
                "server_name": server_name,
                "category": "global",
                "source_path": normalized_source_path,
                "can_edit": True,
                "config_json": payload,
            }

        listed = self.list_mcp_profiles()["profiles"]
        lowered_name = str(name).strip().lower()
        matches = [profile for profile in listed if str(profile.get("name", "")).strip().lower() == lowered_name]
        if not matches:
            raise ValueError(f"MCP profile '{name}' not found")
        if len(matches) > 1:
            scopes = ", ".join(str(profile["source_path"]) for profile in matches)
            raise ValueError(f"MCP profile '{name}' is ambiguous across: {scopes}")
        return matches[0]

    def create_mcp_profile(self, name: str, config_json: dict[str, Any]) -> dict:
        """Create a global MCP library item from canonical mcpServers JSON."""
        normalized_name = str(name or "").strip()
        if not normalized_name:
            raise ValueError("MCP profile name is required")
        paths = get_paths()
        profile_file = paths.mcp_profile_file(normalized_name)
        if profile_file.exists():
            raise FileExistsError(f"MCP profile '{normalized_name}' already exists")

        source_path = write_mcp_profile(
            name=normalized_name,
            config_json=config_json,
            paths=paths,
        )
        return self.get_mcp_profile(profile_file.stem, source_path)

    def update_mcp_profile(self, name: str, config_json: dict[str, Any], source_path: str | None = None) -> dict:
        """Update an existing global MCP library item."""
        profile = self.get_mcp_profile(name, source_path)
        if profile.get("can_edit") is not True:
            raise ValueError(f"MCP profile '{name}' is read-only")
        paths = get_paths()
        source_path_value = str(profile["source_path"])
        resolved_file = resolve_mcp_profile_file(source_path_value, paths=paths)
        write_mcp_profile(
            name=resolved_file.name,
            config_json=config_json,
            paths=paths,
        )
        return self.get_mcp_profile(resolved_file.stem, str(profile["source_path"]))

    def delete_mcp_profile(self, name: str, source_path: str | None = None) -> None:
        """Delete an editable global MCP library item."""
        profile = self.get_mcp_profile(name, source_path)
        if profile.get("can_edit") is not True:
            raise ValueError(f"MCP profile '{name}' is read-only")
        resolved_file = resolve_mcp_profile_file(str(profile["source_path"]), paths=get_paths())
        resolved_file.unlink()

    # ------------------------------------------------------------------
    # Public API — skills management
    # ------------------------------------------------------------------

    def get_skill(self, name: str) -> dict | None:
        """Get a specific skill by name.

        Args:
            name: Skill name.

        Returns:
            Skill info dict, or None if not found.
        """
        from src.skills.loader import load_skills

        skill = next((s for s in load_skills(enabled_only=False) if s.name == name), None)
        if skill is None:
            return None
        return {
            "name": skill.name,
            "description": skill.description,
            "license": skill.license,
            "category": skill.category,
            "enabled": skill.enabled,
        }

    def update_skill(self, name: str, *, enabled: bool) -> dict:
        """Update a skill's enabled status.

        Args:
            name: Skill name.
            enabled: New enabled status.

        Returns:
            Updated skill info dict.

        Raises:
            ValueError: If the skill is not found.
            OSError: If the config file cannot be written.
        """
        from src.skills.loader import load_skills

        skills = load_skills(enabled_only=False)
        skill = next((s for s in skills if s.name == name), None)
        if skill is None:
            raise ValueError(f"Skill '{name}' not found")

        config_path = ExtensionsConfig.resolve_config_path()
        if config_path is None:
            raise FileNotFoundError("Cannot locate extensions_config.json. Set OPENAGENTS_EXTENSIONS_CONFIG_PATH or ensure it exists in the project root.")

        extensions_config = get_extensions_config()
        extensions_config.skills[name] = SkillStateConfig(enabled=enabled)

        config_data = {
            "mcpServers": {n: s.model_dump() for n, s in extensions_config.mcp_servers.items()},
            "skills": {n: {"enabled": sc.enabled} for n, sc in extensions_config.skills.items()},
        }

        self._atomic_write_json(config_path, config_data)

        self._agent = None
        reload_extensions_config()

        updated = next((s for s in load_skills(enabled_only=False) if s.name == name), None)
        if updated is None:
            raise RuntimeError(f"Skill '{name}' disappeared after update")
        return {
            "name": updated.name,
            "description": updated.description,
            "license": updated.license,
            "category": updated.category,
            "enabled": updated.enabled,
        }

    def install_skill(self, skill_path: str | Path) -> dict:
        """Install a skill from a .skill archive (ZIP).

        Args:
            skill_path: Path to the .skill file.

        Returns:
            Dict with success, skill_name, message.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file is invalid.
        """
        from src.gateway.routers.skills import _validate_skill_frontmatter

        path = Path(skill_path)
        if not path.exists():
            raise FileNotFoundError(f"Skill file not found: {skill_path}")
        if not path.is_file():
            raise ValueError(f"Path is not a file: {skill_path}")
        if path.suffix != ".skill":
            raise ValueError("File must have .skill extension")
        if not zipfile.is_zipfile(path):
            raise ValueError("File is not a valid ZIP archive")

        target_root = get_paths().custom_skills_dir
        target_root.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with zipfile.ZipFile(path, "r") as zf:
                total_size = sum(info.file_size for info in zf.infolist())
                if total_size > 100 * 1024 * 1024:
                    raise ValueError("Skill archive too large when extracted (>100MB)")
                for info in zf.infolist():
                    if Path(info.filename).is_absolute() or ".." in Path(info.filename).parts:
                        raise ValueError(f"Unsafe path in archive: {info.filename}")
                zf.extractall(tmp_path)
            for p in tmp_path.rglob("*"):
                if p.is_symlink():
                    p.unlink()

            items = list(tmp_path.iterdir())
            if not items:
                raise ValueError("Skill archive is empty")

            skill_dir = items[0] if len(items) == 1 and items[0].is_dir() else tmp_path

            is_valid, message, skill_name = _validate_skill_frontmatter(skill_dir)
            if not is_valid:
                raise ValueError(f"Invalid skill: {message}")
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", skill_name):
                raise ValueError(f"Invalid skill name: {skill_name}")

            target = target_root / skill_name
            if target.exists():
                raise ValueError(f"Skill '{skill_name}' already exists")

            shutil.copytree(skill_dir, target)

        return {"success": True, "skill_name": skill_name, "message": f"Skill '{skill_name}' installed successfully"}

    # ------------------------------------------------------------------
    # Public API — memory management
    # ------------------------------------------------------------------

    def reload_memory(self, *, user_id: str, agent_name: str, agent_status: str = "dev") -> dict:
        """Reload memory data from file, forcing cache invalidation.

        Returns:
            The reloaded memory data dict.
        """
        from src.agents.memory.updater import reload_memory_data

        return reload_memory_data(
            user_id=user_id,
            agent_name=agent_name,
            agent_status=agent_status,
        )

    def get_memory_config(self, *, agent_name: str, agent_status: str = "dev") -> dict:
        """Get per-agent memory configuration.

        Returns:
            Memory config dict.
        """
        agent_config = load_agent_config(agent_name, status=agent_status)
        config = agent_config.memory
        return {
            "enabled": config.enabled,
            "model_name": config.model_name,
            "debounce_seconds": config.debounce_seconds,
            "max_facts": config.max_facts,
            "fact_confidence_threshold": config.fact_confidence_threshold,
            "injection_enabled": config.injection_enabled,
            "max_injection_tokens": config.max_injection_tokens,
        }

    def get_memory_status(self, *, user_id: str, agent_name: str, agent_status: str = "dev") -> dict:
        """Get memory status: config + current data.

        Returns:
            Dict with "config" and "data" keys.
        """
        return {
            "config": self.get_memory_config(agent_name=agent_name, agent_status=agent_status),
            "data": self.get_memory(user_id=user_id, agent_name=agent_name, agent_status=agent_status),
        }

    # ------------------------------------------------------------------
    # Public API — file uploads
    # ------------------------------------------------------------------

    @staticmethod
    def _get_uploads_dir(thread_id: str) -> Path:
        """Get (and create) the uploads directory for a thread."""
        base = get_paths().sandbox_uploads_dir(thread_id)
        base.mkdir(parents=True, exist_ok=True)
        return base

    def upload_files(self, thread_id: str, files: list[str | Path]) -> dict:
        """Upload local files into a thread's uploads directory.

        For PDF, PPT, Excel, and Word files, they are also converted to Markdown.

        Args:
            thread_id: Target thread ID.
            files: List of local file paths to upload.

        Returns:
            Dict with success, files, message — matching the Gateway API
            ``UploadResponse`` schema.

        Raises:
            FileNotFoundError: If any file does not exist.
        """
        from src.gateway.uploads_utils import (
            attach_markdown_metadata,
            convert_file_to_markdown,
            is_convertible_upload,
            upload_artifact_url,
            upload_virtual_path,
        )

        # Validate all files upfront to avoid partial uploads.
        resolved_files = []
        for f in files:
            p = Path(f)
            if not p.exists():
                raise FileNotFoundError(f"File not found: {f}")
            resolved_files.append(p)

        uploads_dir = self._get_uploads_dir(thread_id)
        uploaded_files: list[dict] = []

        for src_path in resolved_files:
            dest = uploads_dir / src_path.name
            shutil.copy2(src_path, dest)

            info: dict[str, Any] = {
                "filename": src_path.name,
                "size": str(dest.stat().st_size),
                "path": str(dest),
                "virtual_path": upload_virtual_path(src_path.name),
                "artifact_url": upload_artifact_url(thread_id, src_path.name),
            }

            if is_convertible_upload(src_path.name):
                try:
                    try:
                        asyncio.get_running_loop()
                        import concurrent.futures

                        with concurrent.futures.ThreadPoolExecutor() as pool:
                            md_path = pool.submit(lambda: asyncio.run(convert_file_to_markdown(dest))).result()
                    except RuntimeError:
                        md_path = asyncio.run(convert_file_to_markdown(dest))
                except Exception:
                    logger.warning("Failed to convert %s to markdown", src_path.name, exc_info=True)
                    md_path = None

                if md_path is not None:
                    attach_markdown_metadata(info, thread_id=thread_id, markdown_filename=md_path.name)

            uploaded_files.append(info)

        return {
            "success": True,
            "files": uploaded_files,
            "message": f"Successfully uploaded {len(uploaded_files)} file(s)",
        }

    def list_uploads(self, thread_id: str) -> dict:
        """List files in a thread's uploads directory.

        Args:
            thread_id: Thread ID.

        Returns:
            Dict with "files" and "count" keys, matching the Gateway API
            ``list_uploaded_files`` response.
        """
        uploads_dir = self._get_uploads_dir(thread_id)
        if not uploads_dir.exists():
            return {"files": [], "count": 0}

        from src.gateway.uploads_utils import (
            attach_markdown_metadata,
            find_markdown_companion,
            upload_artifact_url,
            upload_virtual_path,
            visible_upload_paths,
        )

        files = []
        visible_paths = visible_upload_paths(uploads_dir)
        available_filenames = {fp.name for fp in uploads_dir.iterdir() if fp.is_file()}
        for fp in visible_paths:
            stat = fp.stat()
            file_info = {
                "filename": fp.name,
                "size": stat.st_size,
                "path": str(fp),
                "virtual_path": upload_virtual_path(fp.name),
                "artifact_url": upload_artifact_url(thread_id, fp.name),
                "extension": fp.suffix,
                "modified": stat.st_mtime,
            }
            markdown_filename = find_markdown_companion(fp.name, available_filenames)
            if markdown_filename:
                attach_markdown_metadata(file_info, thread_id=thread_id, markdown_filename=markdown_filename)
            files.append(file_info)
        return {"files": files, "count": len(files)}

    def delete_upload(self, thread_id: str, filename: str) -> dict:
        """Delete a file from a thread's uploads directory.

        Args:
            thread_id: Thread ID.
            filename: Filename to delete.

        Returns:
            Dict with success and message, matching the Gateway API
            ``delete_uploaded_file`` response.

        Raises:
            FileNotFoundError: If the file does not exist.
            PermissionError: If path traversal is detected.
        """
        from src.gateway.uploads_utils import is_convertible_upload, markdown_companion_name

        uploads_dir = self._get_uploads_dir(thread_id)
        file_path = (uploads_dir / filename).resolve()

        try:
            file_path.relative_to(uploads_dir.resolve())
        except ValueError as exc:
            raise PermissionError("Access denied: path traversal detected") from exc

        if not file_path.is_file():
            raise FileNotFoundError(f"File not found: {filename}")

        file_path.unlink()
        if is_convertible_upload(filename):
            companion_path = uploads_dir / markdown_companion_name(filename)
            if companion_path.exists():
                companion_path.unlink()
        return {"success": True, "message": f"Deleted {filename}"}

    # ------------------------------------------------------------------
    # Public API — artifacts
    # ------------------------------------------------------------------

    def get_artifact(self, thread_id: str, path: str) -> tuple[bytes, str]:
        """Read an artifact file produced by the agent.

        Args:
            thread_id: Thread ID.
            path: Virtual path (e.g. "mnt/user-data/outputs/file.txt").

        Returns:
            Tuple of (file_bytes, mime_type).

        Raises:
            FileNotFoundError: If the artifact does not exist.
            ValueError: If the path is invalid.
        """
        virtual_prefix = "mnt/user-data"
        clean_path = path.lstrip("/")
        if not clean_path.startswith(virtual_prefix):
            raise ValueError(f"Path must start with /{virtual_prefix}")

        relative = clean_path[len(virtual_prefix) :].lstrip("/")
        base_dir = get_paths().sandbox_user_data_dir(thread_id)
        actual = (base_dir / relative).resolve()

        try:
            actual.relative_to(base_dir.resolve())
        except ValueError as exc:
            raise PermissionError("Access denied: path traversal detected") from exc
        if not actual.exists():
            raise FileNotFoundError(f"Artifact not found: {path}")
        if not actual.is_file():
            raise ValueError(f"Path is not a file: {path}")

        mime_type, _ = mimetypes.guess_type(actual)
        return actual.read_bytes(), mime_type or "application/octet-stream"
