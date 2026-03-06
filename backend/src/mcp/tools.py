"""Load MCP tools using langchain-mcp-adapters."""

import logging

from langchain_core.tools import BaseTool

from src.config.extensions_config import ExtensionsConfig
from src.mcp.client import build_servers_config
from src.mcp.oauth import build_oauth_tool_interceptor, get_initial_oauth_headers

logger = logging.getLogger(__name__)


async def _build_client(extensions_config: ExtensionsConfig):
    """Build a MultiServerMCPClient with OAuth headers and interceptors.

    Returns:
        Tuple of (client, servers_config) or (None, None) if no servers.
    """
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning("langchain-mcp-adapters not installed. Install it to enable MCP tools: pip install langchain-mcp-adapters")
        return None, None

    servers_config = build_servers_config(extensions_config)
    if not servers_config:
        logger.info("No enabled MCP servers configured")
        return None, None

    logger.info(f"Initializing MCP client with {len(servers_config)} server(s)")

    # Inject initial OAuth headers
    initial_oauth_headers = await get_initial_oauth_headers(extensions_config)
    for server_name, auth_header in initial_oauth_headers.items():
        if server_name not in servers_config:
            continue
        if servers_config[server_name].get("transport") in ("sse", "http"):
            existing_headers = dict(servers_config[server_name].get("headers", {}))
            existing_headers["Authorization"] = auth_header
            servers_config[server_name]["headers"] = existing_headers

    tool_interceptors = []
    oauth_interceptor = build_oauth_tool_interceptor(extensions_config)
    if oauth_interceptor is not None:
        tool_interceptors.append(oauth_interceptor)

    client = MultiServerMCPClient(servers_config, tool_interceptors=tool_interceptors)
    return client, servers_config


async def get_mcp_tools() -> list[BaseTool]:
    """Get all tools from enabled MCP servers.

    Returns:
        List of LangChain tools from all enabled MCP servers.
    """
    extensions_config = ExtensionsConfig.from_file()
    client, _ = await _build_client(extensions_config)
    if client is None:
        return []

    try:
        tools = await client.get_tools()
        logger.info(f"Successfully loaded {len(tools)} tool(s) from MCP servers")
        return tools
    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        return []


async def get_mcp_tools_by_server() -> dict[str, list[BaseTool]]:
    """Get tools from enabled MCP servers, grouped by server name.

    Returns:
        Dict mapping server name to list of tools.
    """
    extensions_config = ExtensionsConfig.from_file()
    client, servers_config = await _build_client(extensions_config)
    if client is None:
        return {}

    result: dict[str, list[BaseTool]] = {}
    for server_name in servers_config:
        try:
            tools = await client.get_tools(server_name=server_name)
            result[server_name] = tools
            logger.info(f"Loaded {len(tools)} tool(s) from MCP server '{server_name}'")
        except Exception as e:
            logger.error(f"Failed to load tools from MCP server '{server_name}': {e}")
            result[server_name] = []

    total = sum(len(t) for t in result.values())
    logger.info(f"Successfully loaded {total} tool(s) from {len(result)} MCP server(s)")
    return result
