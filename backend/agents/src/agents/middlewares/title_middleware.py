"""Middleware for automatic thread title generation."""

import logging
from collections.abc import Mapping
from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.config import get_config
from langgraph.runtime import Runtime

from src.config.runtime_db import get_runtime_db_store
from src.config.title_config import get_title_config
from src.models import create_chat_model

logger = logging.getLogger(__name__)


class TitleMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    title: NotRequired[str | None]


class TitleMiddleware(AgentMiddleware[TitleMiddlewareState]):
    """Automatically generate a title for the thread after the first user message."""

    state_schema = TitleMiddlewareState

    @staticmethod
    def _coerce_context_value(source: object, key: str) -> str | None:
        if source is None:
            return None

        candidate_keys = (key, key.replace("-", "_"))
        value = None
        if isinstance(source, Mapping):
            for candidate in candidate_keys:
                value = source.get(candidate)
                if value is not None:
                    break
        else:
            for candidate in candidate_keys:
                value = getattr(source, candidate, None)
                if value is not None:
                    break

        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @classmethod
    def _runtime_context_value(cls, runtime: Runtime, *keys: str) -> str | None:
        sources: list[object] = [getattr(runtime, "context", None)]

        try:
            config = get_config()
        except RuntimeError:
            config = None

        if isinstance(config, Mapping):
            sources.append(config.get("configurable"))
            sources.append(config.get("metadata"))
            sources.append(config)

        for source in sources:
            for key in keys:
                value = cls._coerce_context_value(source, key)
                if value is not None:
                    return value
        return None

    @staticmethod
    def _fallback_title(user_message: str, max_chars: int) -> str:
        fallback_limit = min(max_chars, 50)
        if len(user_message) > fallback_limit:
            return user_message[:fallback_limit].rstrip() + "..."
        return user_message or "New Conversation"

    def _persist_title(self, runtime: Runtime, title: str) -> None:
        thread_id = self._runtime_context_value(runtime, "thread_id", "x-thread-id")
        user_id = self._runtime_context_value(runtime, "user_id", "x-user-id")
        if not thread_id or not user_id:
            return

        try:
            get_runtime_db_store().save_thread_title(
                thread_id=thread_id,
                user_id=user_id,
                title=title,
            )
        except Exception:
            logger.warning(
                "Failed to persist thread title for thread %s",
                thread_id,
                exc_info=True,
            )

    def _should_generate_title(self, state: TitleMiddlewareState) -> bool:
        """Check if we should generate a title for this thread."""
        config = get_title_config()
        if not config.enabled:
            return False

        # Check if thread already has a title in state
        if state.get("title"):
            return False

        # Check if this is the first turn (has at least one user message and one assistant response)
        messages = state.get("messages", [])
        if len(messages) < 2:
            return False

        # Count user and assistant messages
        user_messages = [m for m in messages if m.type == "human"]
        assistant_messages = [m for m in messages if m.type == "ai"]

        # Generate title after first complete exchange
        return len(user_messages) == 1 and len(assistant_messages) >= 1

    @staticmethod
    def _stringify_message_content(content: object) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: list[str] = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text")
                    if text is not None:
                        text_parts.append(str(text))
            return "\n".join(part for part in text_parts if part)
        return str(content) if content else ""

    def _generate_title(self, state: TitleMiddlewareState) -> str:
        """Generate a concise title based on the conversation."""
        config = get_title_config()
        messages = state.get("messages", [])

        # Get first user message and first assistant response
        user_msg_content = next((m.content for m in messages if m.type == "human"), "")
        assistant_msg_content = next((m.content for m in messages if m.type == "ai"), "")

        # Ensure content is string (LangChain messages can have list content)
        user_msg = self._stringify_message_content(user_msg_content)
        assistant_msg = self._stringify_message_content(assistant_msg_content)

        if not config.model_name:
            return self._fallback_title(user_msg, config.max_chars)

        # Use explicitly configured title model; no implicit default model fallback.
        model = create_chat_model(name=config.model_name, thinking_enabled=False)

        prompt = config.prompt_template.format(
            max_words=config.max_words,
            max_chars=config.max_chars,
            user_msg=user_msg[:500],
            assistant_msg=assistant_msg[:500],
        )

        try:
            response = model.invoke(prompt)
            # Ensure response content is string
            title_content = str(response.content) if response.content else ""
            title = title_content.strip().strip('"').strip("'")
            # Limit to max characters
            return title[: config.max_chars] if len(title) > config.max_chars else title
        except Exception:
            logger.warning("Failed to generate thread title with model", exc_info=True)
            return self._fallback_title(user_msg, config.max_chars)

    @override
    def after_agent(self, state: TitleMiddlewareState, runtime: Runtime) -> dict | None:
        """Generate and set thread title after the first agent response."""
        if not self._should_generate_title(state):
            return None

        title = self._generate_title(state)
        logger.info("Generated thread title: %s", title)
        self._persist_title(runtime, title)

        # Store title in state (will be persisted by checkpointer if configured)
        return {"title": title}
