"""Backend-owned runtime defaults for agent requests."""

# Lead-agent runs should expose delegated subtasks by default unless a caller
# explicitly disables them for a specific request.
DEFAULT_SUBAGENT_ENABLED = True
