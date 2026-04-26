from __future__ import annotations

from deepagents.middleware.summarization import SummarizationMiddleware

from src.config.summarization_config import (
    CLAUDE_CODE_COMPACTION_PROMPT,
    get_summarization_config,
    load_summarization_config_from_dict,
)


def test_default_compaction_prompt_includes_conversation_history_placeholder():
    rendered = CLAUDE_CODE_COMPACTION_PROMPT.format(
        messages="Human: 请记住暗号 BLUE-PANDA-742，后面我要问你。",
    )

    assert "{messages}" in CLAUDE_CODE_COMPACTION_PROMPT
    assert "BLUE-PANDA-742" in rendered
    assert "All user messages" in rendered


def test_compaction_summary_strips_analysis_before_reinjection():
    raw_summary = """
<analysis>
The summarizer used this scratchpad to verify all user facts.
</analysis>

<summary>
1. Primary Request and Intent:
   - The user asked the agent to remember BLUE-PANDA-742.
</summary>
"""

    normalized = SummarizationMiddleware._format_compact_summary(raw_summary)

    assert "scratchpad" not in normalized
    assert "<summary>" not in normalized
    assert "BLUE-PANDA-742" in normalized


def test_yaml_null_summary_prompt_uses_claude_code_default():
    original = get_summarization_config()
    try:
        load_summarization_config_from_dict(
            {
                "enabled": True,
                "summary_prompt": None,
            }
        )

        assert get_summarization_config().summary_prompt == CLAUDE_CODE_COMPACTION_PROMPT
    finally:
        load_summarization_config_from_dict(original.model_dump())
