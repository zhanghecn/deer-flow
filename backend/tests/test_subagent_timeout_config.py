"""Tests for subagent timeout configuration.

Covers:
- SubagentsAppConfig / SubagentOverrideConfig model validation and defaults
- get_timeout_for() resolution logic (global vs per-agent)
- load_subagents_config_from_dict() and get_subagents_app_config() singleton

Note: registry and task_tool tests were removed as src.subagents is now
replaced by deepagents SubAgentMiddleware.
"""

import pytest

from src.config.subagents_config import (
    SubagentOverrideConfig,
    SubagentsAppConfig,
    get_subagents_app_config,
    load_subagents_config_from_dict,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _reset_subagents_config(timeout_seconds: int = 900, agents: dict | None = None) -> None:
    """Reset global subagents config to a known state."""
    load_subagents_config_from_dict({"timeout_seconds": timeout_seconds, "agents": agents or {}})


# ---------------------------------------------------------------------------
# SubagentOverrideConfig
# ---------------------------------------------------------------------------


class TestSubagentOverrideConfig:
    def test_default_is_none(self):
        override = SubagentOverrideConfig()
        assert override.timeout_seconds is None

    def test_explicit_value(self):
        override = SubagentOverrideConfig(timeout_seconds=300)
        assert override.timeout_seconds == 300

    def test_rejects_zero(self):
        with pytest.raises(ValueError):
            SubagentOverrideConfig(timeout_seconds=0)

    def test_rejects_negative(self):
        with pytest.raises(ValueError):
            SubagentOverrideConfig(timeout_seconds=-1)

    def test_minimum_valid_value(self):
        override = SubagentOverrideConfig(timeout_seconds=1)
        assert override.timeout_seconds == 1


# ---------------------------------------------------------------------------
# SubagentsAppConfig – defaults and validation
# ---------------------------------------------------------------------------


class TestSubagentsAppConfigDefaults:
    def test_default_timeout(self):
        config = SubagentsAppConfig()
        assert config.timeout_seconds == 900

    def test_default_agents_empty(self):
        config = SubagentsAppConfig()
        assert config.agents == {}

    def test_custom_global_timeout(self):
        config = SubagentsAppConfig(timeout_seconds=1800)
        assert config.timeout_seconds == 1800

    def test_rejects_zero_timeout(self):
        with pytest.raises(ValueError):
            SubagentsAppConfig(timeout_seconds=0)

    def test_rejects_negative_timeout(self):
        with pytest.raises(ValueError):
            SubagentsAppConfig(timeout_seconds=-60)


# ---------------------------------------------------------------------------
# SubagentsAppConfig.get_timeout_for()
# ---------------------------------------------------------------------------


class TestGetTimeoutFor:
    def test_returns_global_default_when_no_override(self):
        config = SubagentsAppConfig(timeout_seconds=600)
        assert config.get_timeout_for("general-purpose") == 600
        assert config.get_timeout_for("bash") == 600
        assert config.get_timeout_for("unknown-agent") == 600

    def test_returns_per_agent_override_when_set(self):
        config = SubagentsAppConfig(
            timeout_seconds=900,
            agents={"bash": SubagentOverrideConfig(timeout_seconds=300)},
        )
        assert config.get_timeout_for("bash") == 300

    def test_other_agents_still_use_global_default(self):
        config = SubagentsAppConfig(
            timeout_seconds=900,
            agents={"bash": SubagentOverrideConfig(timeout_seconds=300)},
        )
        assert config.get_timeout_for("general-purpose") == 900

    def test_agent_with_none_override_falls_back_to_global(self):
        config = SubagentsAppConfig(
            timeout_seconds=900,
            agents={"general-purpose": SubagentOverrideConfig(timeout_seconds=None)},
        )
        assert config.get_timeout_for("general-purpose") == 900

    def test_multiple_per_agent_overrides(self):
        config = SubagentsAppConfig(
            timeout_seconds=900,
            agents={
                "general-purpose": SubagentOverrideConfig(timeout_seconds=1800),
                "bash": SubagentOverrideConfig(timeout_seconds=120),
            },
        )
        assert config.get_timeout_for("general-purpose") == 1800
        assert config.get_timeout_for("bash") == 120


# ---------------------------------------------------------------------------
# load_subagents_config_from_dict / get_subagents_app_config singleton
# ---------------------------------------------------------------------------


class TestLoadSubagentsConfig:
    def teardown_method(self):
        """Restore defaults after each test."""
        _reset_subagents_config()

    def test_load_global_timeout(self):
        load_subagents_config_from_dict({"timeout_seconds": 300})
        assert get_subagents_app_config().timeout_seconds == 300

    def test_load_with_per_agent_overrides(self):
        load_subagents_config_from_dict(
            {
                "timeout_seconds": 900,
                "agents": {
                    "general-purpose": {"timeout_seconds": 1800},
                    "bash": {"timeout_seconds": 60},
                },
            }
        )
        cfg = get_subagents_app_config()
        assert cfg.get_timeout_for("general-purpose") == 1800
        assert cfg.get_timeout_for("bash") == 60

    def test_load_partial_override(self):
        load_subagents_config_from_dict(
            {
                "timeout_seconds": 600,
                "agents": {"bash": {"timeout_seconds": 120}},
            }
        )
        cfg = get_subagents_app_config()
        assert cfg.get_timeout_for("general-purpose") == 600
        assert cfg.get_timeout_for("bash") == 120

    def test_load_empty_dict_uses_defaults(self):
        load_subagents_config_from_dict({})
        cfg = get_subagents_app_config()
        assert cfg.timeout_seconds == 900
        assert cfg.agents == {}

    def test_load_replaces_previous_config(self):
        load_subagents_config_from_dict({"timeout_seconds": 100})
        assert get_subagents_app_config().timeout_seconds == 100

        load_subagents_config_from_dict({"timeout_seconds": 200})
        assert get_subagents_app_config().timeout_seconds == 200

    def test_singleton_returns_same_instance_between_calls(self):
        load_subagents_config_from_dict({"timeout_seconds": 777})
        assert get_subagents_app_config() is get_subagents_app_config()
