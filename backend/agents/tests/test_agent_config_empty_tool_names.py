from src.config.agents_config import (
    AgentConfig,
    AgentSubagentConfig,
    AgentSubagentDefaults,
)


def test_agent_config_preserves_explicit_empty_tool_names() -> None:
    config = AgentConfig.model_validate(
        {
            "name": "support-cases-http-demo",
            "status": "dev",
            "tool_names": [],
            "mcp_servers": ["mcp-profiles/customer-cases-http-demo.json"],
        }
    )

    assert config.tool_names == []


def test_subagent_defaults_preserve_explicit_empty_tool_names() -> None:
    defaults = AgentSubagentDefaults.model_validate(
        {
            "general_purpose_enabled": True,
            "tool_names": [],
        }
    )

    assert defaults.tool_names == []


def test_subagent_config_preserves_explicit_empty_tool_names() -> None:
    subagent = AgentSubagentConfig.model_validate(
        {
            "name": "retriever",
            "description": "Retrieve customer cases",
            "system_prompt": "Use MCP tools only.",
            "tool_names": [],
        }
    )

    assert subagent.tool_names == []
