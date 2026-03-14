from unittest.mock import MagicMock, patch
from uuid import uuid4

from langchain_core.messages import AIMessage

from src.observability.callbacks import (
    AgentTraceCallbackHandler,
    _extract_model_request_context,
    _serialize_message,
    _shrink,
)


def test_shrink_preserves_message_structure_when_text_is_long():
    messages = [
        {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": "A" * 5000,
                }
            ],
        }
    ]

    result = _shrink(messages, max_string_len=120)

    assert isinstance(result, list)
    assert result[0]["role"] == "system"
    assert isinstance(result[0]["content"], list)
    assert isinstance(result[0]["content"][0]["text"], str)
    assert "[truncated " in result[0]["content"][0]["text"]


def test_extract_model_request_context_keeps_tool_registration_without_secret_fields():
    context = _extract_model_request_context(
        {"name": "chat-model"},
        {
            "invocation_params": {
                "model": "kimi-k2.5-1",
                "temperature": 0.2,
                "max_tokens": 4096,
                "reasoning_effort": "minimal",
                "tool_choice": "auto",
                "api_key": "secret-value",
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "description": "Read a file",
                            "parameters": {"type": "object"},
                        },
                    }
                ],
            },
            "options": {
                "stop": ["END"],
            },
        },
    )

    assert context["model"] == "kimi-k2.5-1"
    assert context["tool_choice"] == "auto"
    assert context["settings"]["temperature"] == 0.2
    assert context["settings"]["max_tokens"] == 4096
    assert context["settings"]["reasoning_effort"] == "minimal"
    assert context["options"]["stop"] == ["END"]
    assert context["tools"][0]["name"] == "read_file"
    assert "api_key" not in context


def test_serialize_message_keeps_reasoning_content():
    message = AIMessage(
        content="final answer",
        additional_kwargs={"reasoning_content": "internal reasoning"},
    )

    result = _serialize_message(message)

    assert result["content"] == "final answer"
    assert result["additional_kwargs"]["reasoning_content"] == "internal reasoning"


def test_record_system_event_persists_context_window_snapshot():
    store = MagicMock()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="lead_agent",
            model_name="kimi-k2.5-1",
        )

    callback.record_system_event(
        node_name="ContextWindow",
        payload={"context_window": {"usage_ratio": 0.72, "summary_applied": True}},
    )

    store.append_event.assert_called_once()
    payload = store.append_event.call_args.kwargs["payload"]
    assert payload["context_window"]["usage_ratio"] == 0.72
    assert payload["context_window"]["summary_applied"] is True
    assert store.append_event.call_args.kwargs["run_type"] == "system"


def test_on_chain_end_records_context_window_system_event_from_direct_output():
    store = MagicMock()
    run_id = uuid4()

    outputs = {
        "outputs": {
            "context_window": {
                "approx_input_tokens": 30448,
                "max_input_tokens": 200_000,
                "usage_ratio": 0.15224,
                "summary_applied": True,
                "last_summary": {
                    "cutoff_index": 43,
                    "file_path": "/conversation_history/thread-1.md",
                    "summary_preview": "summary text",
                },
            }
        }
    }

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="lead_agent",
            model_name="kimi-k2.5-1",
        )

        callback.on_chain_start(
            {"name": "lead_agent"},
            {"messages": []},
            run_id=run_id,
        )
        callback.on_chain_end(outputs, run_id=run_id)

    system_calls = [
        call.kwargs
        for call in store.append_event.call_args_list
        if call.kwargs["run_type"] == "system"
    ]
    assert len(system_calls) == 1

    payload = system_calls[0]["payload"]["context_window"]
    assert payload["summary_applied"] is True
    assert payload["approx_input_tokens"] == 30448
    assert payload["max_input_tokens"] == 200_000
    assert payload["usage_ratio"] == 0.15224
    assert payload["last_summary"]["cutoff_index"] == 43
    assert payload["last_summary"]["file_path"] == "/conversation_history/thread-1.md"
    assert payload["last_summary"]["summary_preview"] == "summary text"
