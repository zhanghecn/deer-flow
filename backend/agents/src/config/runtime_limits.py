"""Server-owned execution limits for agent runs."""

# Keep the recursion limit backend-owned so UI callers cannot silently widen or
# shrink the graph step budget per request.
DEFAULT_AGENT_RECURSION_LIMIT = 3500
