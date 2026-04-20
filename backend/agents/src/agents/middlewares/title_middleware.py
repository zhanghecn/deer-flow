"""Middleware for automatic thread title generation."""

import logging
import re
from collections.abc import Mapping
from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_config
from langgraph.runtime import Runtime

from src.config.runtime_db import get_runtime_db_store
from src.config.title_config import get_title_config

logger = logging.getLogger(__name__)

_UPLOADED_FILES_BLOCK_RE = re.compile(r"<uploaded_files>[\s\S]*?</uploaded_files>\s*", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"\s+")
_ESCAPED_WHITESPACE_RE = re.compile(r"\\+(?:r\\n|n|r|t)")
_ROLE_PREFIX_RE = re.compile(r"^(user|assistant|human|system)\s*:\s*(.*)$", re.IGNORECASE)


class TitleMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    title: NotRequired[str | None]


class TitleMiddleware(AgentMiddleware[TitleMiddlewareState]):
    """Persist a compact title from the first real user turn.

    Deep Agents already spends model budget on the actual user task. Title
    generation stays local and deterministic so opening a new thread does not
    trigger an extra model call with its own latency, retries, and failures.
    """

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

    @staticmethod
    def _normalize_title_line(line: str) -> str:
        # SDK and transcript-like callers sometimes wrap the first prompt as
        # `User: ...` or `User:\n...`. Titles should follow the actual task
        # content, not the wrapper label.
        if line.startswith("#"):
            line = line.lstrip("#").strip()

        role_match = _ROLE_PREFIX_RE.match(line)
        if role_match is not None:
            line = role_match.group(2).strip()
            if not line:
                return ""

        return _WHITESPACE_RE.sub(" ", line).strip()

    @classmethod
    def _clean_user_message_for_title(cls, user_message: str) -> str:
        cleaned = _UPLOADED_FILES_BLOCK_RE.sub("", user_message)
        # Some SDK/demo callers serialize control characters into the text form
        # (`\\n`, `\\t`) before the first prompt reaches title generation.
        # Normalize those escapes so titles follow the real sentence instead of
        # preserving transport artifacts.
        cleaned = _ESCAPED_WHITESPACE_RE.sub("\n", cleaned)
        cleaned = cleaned.strip().strip('"').strip("'")
        if not cleaned:
            return ""

        lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
        for line in lines:
            normalized = cls._normalize_title_line(line)
            if normalized:
                return normalized
        return ""

    @classmethod
    def _truncate_title(cls, title: str, *, max_words: int, max_chars: int) -> str:
        normalized = cls._clean_user_message_for_title(title)
        if not normalized:
            return "New Conversation"

        words = normalized.split()
        if len(words) > max_words:
            normalized = " ".join(words[:max_words]).strip()

        normalized = normalized.strip().strip('"').strip("'")
        if len(normalized) > max_chars:
            return normalized[: max_chars - 3].rstrip() + "..."
        return normalized

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

        messages = state.get("messages", [])
        user_messages = [m for m in messages if m.type == "human"]
        # Generate once from the first user turn so SSE/SDK consumers can show
        # a stable title immediately instead of waiting for the first reply.
        return len(user_messages) == 1

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
        """Generate a concise title from the user's first message."""
        config = get_title_config()
        messages = state.get("messages", [])

        # Get first user message.
        user_msg_content = next((m.content for m in messages if m.type == "human"), "")

        user_msg = self._stringify_message_content(user_msg_content)
        if not user_msg.strip():
            return "New Conversation"

        generated = self._truncate_title(
            user_msg,
            max_words=config.max_words,
            max_chars=config.max_chars,
        )
        return generated or self._fallback_title(user_msg, config.max_chars)

    def _maybe_generate_title(self, state: TitleMiddlewareState, runtime: Runtime) -> dict | None:
        if not self._should_generate_title(state):
            return None

        title = self._generate_title(state)
        logger.info("Generated thread title: %s", title)
        self._persist_title(runtime, title)
        return {"title": title}

    @override
    def before_agent(
        self,
        state: TitleMiddlewareState,
        runtime: Runtime,
        config: RunnableConfig | None = None,
    ) -> dict | None:  # ty: ignore[invalid-method-override]
        """Generate the first-turn title before model execution starts."""
        del config
        return self._maybe_generate_title(state, runtime)

    @override
    def after_agent(self, state: TitleMiddlewareState, runtime: Runtime) -> dict | None:
        """Fallback for runtimes that only surface post-agent state updates."""
        return self._maybe_generate_title(state, runtime)
