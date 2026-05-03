from __future__ import annotations

from src.config.model_config import (
    DEEPSEEK_RUNTIME_CLASS,
    migrate_legacy_model_config_payload,
)


def test_migrate_legacy_model_config_recognizes_deepseek_v4() -> None:
    migrated = migrate_legacy_model_config_payload(
        {
            "use": DEEPSEEK_RUNTIME_CLASS,
            "model": "deepseek-v4-pro",
            "supports_thinking": True,
        }
    )

    assert migrated["reasoning"] == {
        "contract": "deepseek_reasoner",
        "default_level": "auto",
    }


def test_migrate_legacy_model_config_skips_deepseek_none_variant() -> None:
    migrated = migrate_legacy_model_config_payload(
        {
            "use": DEEPSEEK_RUNTIME_CLASS,
            "model": "deepseek-v4-pro-none",
            "supports_thinking": True,
        }
    )

    assert "reasoning" not in migrated
