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


def test_agent_config_normalizes_knowledge_base_ids() -> None:
    config = AgentConfig.model_validate(
        {
            "name": "support-cases-http-demo",
            "status": "dev",
            "knowledge_base_ids": [
                " 11111111-1111-1111-1111-111111111111 ",
                "22222222-2222-2222-2222-222222222222",
            ],
        }
    )

    assert config.knowledge_base_ids == [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
    ]


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
