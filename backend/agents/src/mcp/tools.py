"""Load MCP tools using langchain-mcp-adapters."""

import logging

from langchain_core.tools import BaseTool, ToolException
from pydantic import Field

from src.config.extensions_config import ExtensionsConfig
from src.mcp.client import build_servers_config
from src.mcp.oauth import build_oauth_tool_interceptor, get_initial_oauth_headers

logger = logging.getLogger(__name__)


class MCPToolErrorGuard(BaseTool):
    """Convert MCP adapter tools into ordinary model-visible tools.

    LangChain's MCP adapter already handles protocol conversion. This guard
    intentionally exposes a plain `content` tool to the agent so adapter
    internals like `content_and_artifact` do not leak through a second wrapper
    and make result-shape validation fail before the model sees a tool result.
    """

    wrapped_tool: BaseTool = Field(exclude=True)

    def _run(self, *args: object, **kwargs: object) -> object:
        try:
            return self.wrapped_tool.invoke(_delegated_tool_input(args, kwargs))
        except ToolException:
            raise
        except Exception as exc:
            raise ToolException(_format_mcp_tool_error(self.name, exc)) from exc

    async def _arun(self, *args: object, **kwargs: object) -> object:
        try:
            return await self.wrapped_tool.ainvoke(_delegated_tool_input(args, kwargs))
        except ToolException:
            raise
        except Exception as exc:
            raise ToolException(_format_mcp_tool_error(self.name, exc)) from exc


def _delegated_tool_input(args: tuple[object, ...], kwargs: dict[str, object]) -> object:
    if len(args) == 1 and not kwargs:
        return args[0]
    if not args:
        return kwargs
    return {"args": list(args), **kwargs}


def _format_mcp_tool_error(tool_name: str, exc: Exception) -> str:
    detail = str(exc).strip() or type(exc).__name__
    prefix = f"MCP tool '{tool_name}' failed:"
    if detail.startswith(prefix):
        return detail
    return f"MCP tool '{tool_name}' failed: {detail}"


def wrap_mcp_tool_errors(tool: BaseTool) -> BaseTool:
    metadata = dict(tool.metadata or {})
    metadata["mcp_error_guard"] = True
    return MCPToolErrorGuard(
        name=tool.name,
        description=tool.description,
        args_schema=tool.args_schema,
        return_direct=tool.return_direct,
        response_format="content",
        tags=tool.tags,
        metadata=metadata,
        wrapped_tool=tool,
        handle_tool_error=True,
        handle_validation_error=True,
    )


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
        tools = [wrap_mcp_tool_errors(tool) for tool in await client.get_tools()]
        logger.info(f"Successfully loaded {len(tools)} tool(s) from MCP servers")
        return tools
    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        return []


async def get_mcp_tools_for_extensions_config(
    extensions_config: ExtensionsConfig,
    *,
    server_names: list[str] | None = None,
) -> list[BaseTool]:
    """Resolve MCP tools from an explicit config object.

    This bypasses the workspace-global config singleton and is used for the new
    agent-scoped MCP subset path where the active agent binds reusable MCP
    library refs.
    """

    client, servers_config = await _build_client(extensions_config)
    if client is None:
        return []

    requested_server_names = server_names
    if requested_server_names is None:
        requested_server_names = list(servers_config)

    resolved: list[BaseTool] = []
    for server_name in requested_server_names:
        if server_name not in servers_config:
            logger.warning("Explicit MCP server '%s' was not present in the resolved config", server_name)
            continue
        try:
            server_tools = await client.get_tools(server_name=server_name)
            resolved.extend(wrap_mcp_tool_errors(tool) for tool in server_tools)
        except Exception as e:
            logger.error("Failed to load tools from MCP server '%s': %s", server_name, e, exc_info=True)
    return resolved


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
            server_tools = await client.get_tools(server_name=server_name)
            tools = [wrap_mcp_tool_errors(tool) for tool in server_tools]
            result[server_name] = tools
            logger.info(f"Loaded {len(tools)} tool(s) from MCP server '{server_name}'")
        except Exception as e:
            logger.error(f"Failed to load tools from MCP server '{server_name}': {e}")
            result[server_name] = []

    total = sum(len(t) for t in result.values())
    logger.info(f"Successfully loaded {total} tool(s) from {len(result)} MCP server(s)")
    return result
