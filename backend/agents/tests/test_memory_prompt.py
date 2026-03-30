"""Tests for memory prompt/formatting boundaries."""

from langchain_core.messages import AIMessage, HumanMessage

from src.agents.memory.prompt import MEMORY_UPDATE_PROMPT, format_conversation_for_update


def test_memory_update_prompt_explicitly_forbids_upload_event_memory():
    assert "Do NOT record file upload events in memory" in MEMORY_UPDATE_PROMPT


def test_format_conversation_for_update_strips_uploaded_files_block_from_human_turn():
    conversation = format_conversation_for_update(
        [
            HumanMessage(
                content=(
                    "<uploaded_files>\n"
                    "- demo.pdf (12 KB)\n"
                    "  Path: /mnt/user-data/uploads/thread-1/demo.pdf\n"
                    "</uploaded_files>\n\n"
                    "请继续分析这份合同。"
                )
            ),
            AIMessage(content="好的，我继续分析。"),
        ]
    )

    assert "<uploaded_files>" not in conversation
    assert "/mnt/user-data/uploads/" not in conversation
    assert "请继续分析这份合同。" in conversation
    assert "好的，我继续分析。" in conversation


def test_format_conversation_for_update_skips_upload_only_human_turn():
    conversation = format_conversation_for_update(
        [
            HumanMessage(
                content=(
                    "<uploaded_files>\n"
                    "- demo.pdf (12 KB)\n"
                    "  Path: /mnt/user-data/uploads/thread-1/demo.pdf\n"
                    "</uploaded_files>\n"
                )
            ),
            AIMessage(content="已收到文件。"),
        ]
    )

    assert "User:" not in conversation
    assert "Assistant: 已收到文件。" in conversation
