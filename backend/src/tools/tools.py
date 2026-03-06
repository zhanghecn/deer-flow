import logging

from langchain.tools import BaseTool

from src.config import get_app_config
from src.reflection import resolve_variable
from src.tools.builtins import ask_clarification_tool, present_file_tool, view_image_tool

logger = logging.getLogger(__name__)

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
]

def get_available_tools(
    groups: list[str] | None = None,
    exclude_groups: list[str] | None = None,
    include_mcp: bool = True,
    mcp_servers: list[str] | None = None,
    model_name: str | None = None,
    model_supports_vision: bool | None = None,
    subagent_enabled: bool = False,
) -> list[BaseTool]:
    """Get all available tools from config.

    Note: MCP tools should be initialized at application startup using
    `initialize_mcp_tools()` from src.mcp module.

    Args:
        groups: Optional list of tool groups to filter by.
        exclude_groups: Optional list of tool groups to exclude (applied after groups filter).
        include_mcp: Whether to include tools from MCP servers (default: True).
        mcp_servers: Optional list of MCP server names to include.
            If None, includes tools from all enabled servers.
        model_name: Optional model name to determine if vision tools should be included.
        model_supports_vision: Optional direct override for vision support.
        subagent_enabled: Whether to include subagent tools (task, task_status).

    Returns:
        List of available tools.
    """
    config = get_app_config()
    exclude_set = set(exclude_groups) if exclude_groups else set()
    loaded_tools = [
        resolve_variable(tool.use, BaseTool)
        for tool in config.tools
        if (groups is None or tool.group in groups) and tool.group not in exclude_set
    ]

    # Get cached MCP tools if enabled
    # NOTE: We use ExtensionsConfig.from_file() instead of config.extensions
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when loading MCP tools.
    mcp_tools = []
    if include_mcp:
        try:
            from src.config.extensions_config import ExtensionsConfig
            from src.mcp.cache import get_cached_mcp_tools

            extensions_config = ExtensionsConfig.from_file()
            if extensions_config.get_enabled_mcp_servers():
                mcp_tools = get_cached_mcp_tools(server_names=mcp_servers)
                if mcp_tools:
                    server_desc = f"from servers {mcp_servers}" if mcp_servers else "from all servers"
                    logger.info(f"Using {len(mcp_tools)} cached MCP tool(s) {server_desc}")
        except ImportError:
            logger.warning("MCP module not available. Install 'langchain-mcp-adapters' package to enable MCP tools.")
        except Exception as e:
            logger.error(f"Failed to get cached MCP tools: {e}")

    # Conditionally add tools based on config
    builtin_tools = BUILTIN_TOOLS.copy()

    # If no model_name specified, use the first model (default)
    if model_name is None and config.models:
        model_name = config.models[0].name

    # Add view_image_tool only if the model supports vision
    if model_supports_vision is None:
        model_config = config.get_model_config(model_name) if model_name else None
        model_supports_vision = bool(model_config and model_config.supports_vision)

    if model_supports_vision:
        builtin_tools.append(view_image_tool)
        logger.info(f"Including view_image_tool for model '{model_name}' (supports_vision=True)")

    return loaded_tools + builtin_tools + mcp_tools
