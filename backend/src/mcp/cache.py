"""Cache for MCP tools to avoid repeated loading."""

import asyncio
import logging
import os

from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)

# Per-server tool cache: {server_name: [tools]}
_mcp_tools_by_server: dict[str, list[BaseTool]] | None = None
_cache_initialized = False
_initialization_lock = asyncio.Lock()
_config_mtime: float | None = None  # Track config file modification time


def _get_config_mtime() -> float | None:
    """Get the modification time of the extensions config file.

    Returns:
        The modification time as a float, or None if the file doesn't exist.
    """
    from src.config.extensions_config import ExtensionsConfig

    config_path = ExtensionsConfig.resolve_config_path()
    if config_path and config_path.exists():
        return os.path.getmtime(config_path)
    return None


def _is_cache_stale() -> bool:
    """Check if the cache is stale due to config file changes.

    Returns:
        True if the cache should be invalidated, False otherwise.
    """
    global _config_mtime

    if not _cache_initialized:
        return False  # Not initialized yet, not stale

    current_mtime = _get_config_mtime()

    # If we couldn't get mtime before or now, assume not stale
    if _config_mtime is None or current_mtime is None:
        return False

    # If the config file has been modified since we cached, it's stale
    if current_mtime > _config_mtime:
        logger.info(f"MCP config file has been modified (mtime: {_config_mtime} -> {current_mtime}), cache is stale")
        return True

    return False


async def initialize_mcp_tools() -> dict[str, list[BaseTool]]:
    """Initialize and cache MCP tools per server.

    This should be called once at application startup.

    Returns:
        Dict mapping server name to list of tools.
    """
    global _mcp_tools_by_server, _cache_initialized, _config_mtime

    async with _initialization_lock:
        if _cache_initialized:
            logger.info("MCP tools already initialized")
            return _mcp_tools_by_server or {}

        from src.mcp.tools import get_mcp_tools_by_server

        logger.info("Initializing MCP tools...")
        _mcp_tools_by_server = await get_mcp_tools_by_server()
        _cache_initialized = True
        _config_mtime = _get_config_mtime()  # Record config file mtime
        total = sum(len(tools) for tools in _mcp_tools_by_server.values())
        logger.info(f"MCP tools initialized: {total} tool(s) from {len(_mcp_tools_by_server)} server(s) (config mtime: {_config_mtime})")

        return _mcp_tools_by_server


def _ensure_initialized() -> None:
    """Ensure MCP tools are initialized (lazy init if needed)."""
    global _cache_initialized

    # Check if cache is stale due to config file changes
    if _is_cache_stale():
        logger.info("MCP cache is stale, resetting for re-initialization...")
        reset_mcp_tools_cache()

    if not _cache_initialized:
        logger.info("MCP tools not initialized, performing lazy initialization...")
        try:
            # Try to initialize in the current event loop
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, initialize_mcp_tools())
                    future.result()
            else:
                loop.run_until_complete(initialize_mcp_tools())
        except RuntimeError:
            asyncio.run(initialize_mcp_tools())
        except Exception as e:
            logger.error(f"Failed to lazy-initialize MCP tools: {e}")


def get_cached_mcp_tools(server_names: list[str] | None = None) -> list[BaseTool]:
    """Get cached MCP tools, optionally filtered by server names.

    Args:
        server_names: Optional list of MCP server names to include.
            If None, returns tools from all servers.

    Returns:
        List of cached MCP tools.
    """
    _ensure_initialized()

    if _mcp_tools_by_server is None:
        return []

    if server_names is None:
        # Return all tools from all servers
        all_tools = []
        for tools in _mcp_tools_by_server.values():
            all_tools.extend(tools)
        return all_tools

    # Return tools only from specified servers
    filtered = []
    for name in server_names:
        if name in _mcp_tools_by_server:
            filtered.extend(_mcp_tools_by_server[name])
        else:
            logger.warning(f"MCP server '{name}' not found in cache, skipping")
    return filtered


def reset_mcp_tools_cache() -> None:
    """Reset the MCP tools cache.

    This is useful for testing or when you want to reload MCP tools.
    """
    global _mcp_tools_by_server, _cache_initialized, _config_mtime
    _mcp_tools_by_server = None
    _cache_initialized = False
    _config_mtime = None
    logger.info("MCP tools cache reset")
