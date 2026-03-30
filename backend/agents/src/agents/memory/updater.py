"""Memory updater for reading, writing, and updating memory data."""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.agents.memory.prompt import (
    MEMORY_UPDATE_PROMPT,
    format_conversation_for_update,
)
from src.config.agents_config import AgentMemoryConfig
from src.config.paths import get_paths
from src.models import create_chat_model


def _get_memory_file_path(
    *,
    user_id: str,
    agent_name: str,
    agent_status: str = "dev",
) -> Path:
    """Get the path to a user-agent scoped memory file.

    Args:
        user_id: Owning user identifier.
        agent_name: Agent name.
        agent_status: Agent namespace.

    Returns:
        Path to the memory file.
    """
    if not str(user_id).strip():
        raise ValueError("Memory access requires `user_id`.")
    if not str(agent_name).strip():
        raise ValueError("Memory access requires `agent_name`.")
    return get_paths().user_agent_memory_file(str(user_id).strip(), str(agent_name).strip(), agent_status)


def _create_empty_memory() -> dict[str, Any]:
    """Create an empty memory structure."""
    return {
        "version": "1.0",
        "lastUpdated": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "user": {
            "workContext": {"summary": "", "updatedAt": ""},
            "personalContext": {"summary": "", "updatedAt": ""},
            "topOfMind": {"summary": "", "updatedAt": ""},
        },
        "history": {
            "recentMonths": {"summary": "", "updatedAt": ""},
            "earlierContext": {"summary": "", "updatedAt": ""},
            "longTermBackground": {"summary": "", "updatedAt": ""},
        },
        "facts": [],
    }


# Per-user-agent memory cache: keyed by (user_id, agent_name, agent_status)
# Value: (memory_data, file_mtime)
_memory_cache: dict[tuple[str, str, str], tuple[dict[str, Any], float | None]] = {}


def get_memory_data(
    *,
    user_id: str,
    agent_name: str,
    agent_status: str = "dev",
) -> dict[str, Any]:
    """Get the current memory data (cached with file modification time check).

    The cache is automatically invalidated if the memory file has been modified
    since the last load, ensuring fresh data is always returned.

    Args:
        user_id: Owning user identifier.
        agent_name: Agent name.
        agent_status: Agent namespace.

    Returns:
        The memory data dictionary.
    """
    file_path = _get_memory_file_path(user_id=user_id, agent_name=agent_name, agent_status=agent_status)

    # Get current file modification time
    try:
        current_mtime = file_path.stat().st_mtime if file_path.exists() else None
    except OSError:
        current_mtime = None

    cache_key = (user_id, agent_name, agent_status)
    cached = _memory_cache.get(cache_key)

    # Invalidate cache if file has been modified or doesn't exist
    if cached is None or cached[1] != current_mtime:
        memory_data = _load_memory_from_file(user_id=user_id, agent_name=agent_name, agent_status=agent_status)
        _memory_cache[cache_key] = (memory_data, current_mtime)
        return memory_data

    return cached[0]


def reload_memory_data(
    *,
    user_id: str,
    agent_name: str,
    agent_status: str = "dev",
) -> dict[str, Any]:
    """Reload memory data from file, forcing cache invalidation.

    Args:
        user_id: Owning user identifier.
        agent_name: Agent name.
        agent_status: Agent namespace.

    Returns:
        The reloaded memory data dictionary.
    """
    file_path = _get_memory_file_path(user_id=user_id, agent_name=agent_name, agent_status=agent_status)
    memory_data = _load_memory_from_file(user_id=user_id, agent_name=agent_name, agent_status=agent_status)

    try:
        mtime = file_path.stat().st_mtime if file_path.exists() else None
    except OSError:
        mtime = None

    _memory_cache[(user_id, agent_name, agent_status)] = (memory_data, mtime)
    return memory_data


def _load_memory_from_file(
    *,
    user_id: str,
    agent_name: str,
    agent_status: str = "dev",
) -> dict[str, Any]:
    """Load memory data from file.

    Args:
        user_id: Owning user identifier.
        agent_name: Agent name.
        agent_status: Agent namespace.

    Returns:
        The memory data dictionary.
    """
    file_path = _get_memory_file_path(user_id=user_id, agent_name=agent_name, agent_status=agent_status)

    if not file_path.exists():
        return _create_empty_memory()

    try:
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f"Failed to load memory file: {e}")
        return _create_empty_memory()


def _save_memory_to_file(
    memory_data: dict[str, Any],
    *,
    user_id: str,
    agent_name: str,
    agent_status: str = "dev",
) -> bool:
    """Save memory data to file and update cache.

    Args:
        memory_data: The memory data to save.
        user_id: Owning user identifier.
        agent_name: Agent name.
        agent_status: Agent namespace.

    Returns:
        True if successful, False otherwise.
    """
    file_path = _get_memory_file_path(user_id=user_id, agent_name=agent_name, agent_status=agent_status)

    try:
        # Ensure directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Update lastUpdated timestamp
        memory_data["lastUpdated"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        # Write atomically using temp file
        temp_path = file_path.with_suffix(".tmp")
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(memory_data, f, indent=2, ensure_ascii=False)

        # Rename temp file to actual file (atomic on most systems)
        temp_path.replace(file_path)

        # Update cache and file modification time
        try:
            mtime = file_path.stat().st_mtime
        except OSError:
            mtime = None

        _memory_cache[(user_id, agent_name, agent_status)] = (memory_data, mtime)

        print(f"Memory saved to {file_path}")
        return True
    except OSError as e:
        print(f"Failed to save memory file: {e}")
        return False


class MemoryUpdater:
    """Updates memory using LLM based on conversation context."""

    def __init__(self, memory_config: AgentMemoryConfig):
        """Initialize the memory updater.

        Args:
            memory_config: Per-agent memory policy.
        """
        self._memory_config = memory_config

    def _get_model(self):
        """Get the model for memory updates."""
        model_name = self._memory_config.model_name
        if not model_name:
            raise ValueError(
                "Agent memory update model is not configured. Set `agent.memory.model_name`."
            )
        return create_chat_model(name=model_name, thinking_enabled=False)

    def update_memory(
        self,
        messages: list[Any],
        *,
        user_id: str,
        thread_id: str | None = None,
        agent_name: str,
        agent_status: str = "dev",
    ) -> bool:
        """Update memory based on conversation messages.

        Args:
            messages: List of conversation messages.
            user_id: Owning user identifier.
            thread_id: Optional thread ID for tracking source.
            agent_name: Agent name.
            agent_status: Agent namespace.

        Returns:
            True if update was successful, False otherwise.
        """
        if not self._memory_config.enabled:
            return False

        if not messages:
            return False

        try:
            # Get current memory
            current_memory = get_memory_data(
                user_id=user_id,
                agent_name=agent_name,
                agent_status=agent_status,
            )

            # Format conversation for prompt
            conversation_text = format_conversation_for_update(messages)

            if not conversation_text.strip():
                return False

            # Build prompt
            prompt = MEMORY_UPDATE_PROMPT.format(
                current_memory=json.dumps(current_memory, indent=2),
                conversation=conversation_text,
            )

            # Call LLM
            model = self._get_model()
            response = model.invoke(prompt)
            response_text = str(response.content).strip()

            # Parse response
            # Remove markdown code blocks if present
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

            update_data = json.loads(response_text)

            # Apply updates
            updated_memory = self._apply_updates(current_memory, update_data, thread_id)

            # Save
            return _save_memory_to_file(
                updated_memory,
                user_id=user_id,
                agent_name=agent_name,
                agent_status=agent_status,
            )

        except json.JSONDecodeError as e:
            print(f"Failed to parse LLM response for memory update: {e}")
            return False
        except Exception as e:
            print(f"Memory update failed: {e}")
            return False

    def _apply_updates(
        self,
        current_memory: dict[str, Any],
        update_data: dict[str, Any],
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        """Apply LLM-generated updates to memory.

        Args:
            current_memory: Current memory data.
            update_data: Updates from LLM.
            thread_id: Optional thread ID for tracking.

        Returns:
            Updated memory data.
        """
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        # Update user sections
        user_updates = update_data.get("user", {})
        for section in ["workContext", "personalContext", "topOfMind"]:
            section_data = user_updates.get(section, {})
            if section_data.get("shouldUpdate") and section_data.get("summary"):
                current_memory["user"][section] = {
                    "summary": section_data["summary"],
                    "updatedAt": now,
                }

        # Update history sections
        history_updates = update_data.get("history", {})
        for section in ["recentMonths", "earlierContext", "longTermBackground"]:
            section_data = history_updates.get(section, {})
            if section_data.get("shouldUpdate") and section_data.get("summary"):
                current_memory["history"][section] = {
                    "summary": section_data["summary"],
                    "updatedAt": now,
                }

        # Remove facts
        facts_to_remove = set(update_data.get("factsToRemove", []))
        if facts_to_remove:
            current_memory["facts"] = [f for f in current_memory.get("facts", []) if f.get("id") not in facts_to_remove]

        # Add new facts
        new_facts = update_data.get("newFacts", [])
        for fact in new_facts:
            confidence = fact.get("confidence", 0.5)
            if confidence >= self._memory_config.fact_confidence_threshold:
                fact_entry = {
                    "id": f"fact_{uuid.uuid4().hex[:8]}",
                    "content": fact.get("content", ""),
                    "category": fact.get("category", "context"),
                    "confidence": confidence,
                    "createdAt": now,
                    "source": thread_id or "unknown",
                }
                current_memory["facts"].append(fact_entry)

        # Enforce max facts limit
        if len(current_memory["facts"]) > self._memory_config.max_facts:
            # Sort by confidence and keep top ones
            current_memory["facts"] = sorted(
                current_memory["facts"],
                key=lambda f: f.get("confidence", 0),
                reverse=True,
            )[: self._memory_config.max_facts]

        return current_memory


def update_memory_from_conversation(
    messages: list[Any],
    *,
    user_id: str,
    thread_id: str | None = None,
    agent_name: str,
    agent_status: str = "dev",
    memory_config: AgentMemoryConfig,
) -> bool:
    """Convenience function to update memory from a conversation.

    Args:
        messages: List of conversation messages.
        user_id: Owning user identifier.
        thread_id: Optional thread ID.
        agent_name: Agent name.
        agent_status: Agent namespace.
        memory_config: Per-agent memory policy.

    Returns:
        True if successful, False otherwise.
    """
    updater = MemoryUpdater(memory_config)
    return updater.update_memory(
        messages,
        user_id=user_id,
        thread_id=thread_id,
        agent_name=agent_name,
        agent_status=agent_status,
    )
