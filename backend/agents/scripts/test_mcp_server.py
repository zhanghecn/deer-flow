"""Minimal stdio MCP server used for end-to-end integration verification.

This server is intentionally tiny and deterministic so the current-code stack
can exercise a real MCP call path without depending on external services. The
tool result includes a fixed prefix that browser/admin verification can assert.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test-echo")


@mcp.tool()
def test_echo(message: str) -> str:
    """Return a deterministic MCP test payload for integration verification."""

    return f"MCP_TEST_OK:{message}"


if __name__ == "__main__":
    # Stdio transport keeps the server compatible with the repository's
    # existing MCP client path and avoids introducing a second transport shape
    # just for verification.
    mcp.run("stdio")
