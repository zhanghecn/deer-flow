from unittest.mock import MagicMock, patch
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.messages.content import create_image_block

from src.observability.callbacks import (
    AgentTraceCallbackHandler,
    _extract_model_image_inputs,
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
                "effort": "high",
                "reasoning_effort": "high",
                "reasoning": {"effort": "none"},
                "thinking": {"type": "enabled", "budget_tokens": 12000},
                "thinking_budget": 16384,
                "thinking_level": "high",
                "include_thoughts": True,
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
    assert context["settings"]["effort"] == "high"
    assert context["settings"]["reasoning_effort"] == "high"
    assert context["settings"]["reasoning"] == {"effort": "none"}
    assert context["settings"]["thinking"] == {"type": "enabled", "budget_tokens": 12000}
    assert context["settings"]["thinking_budget"] == 16384
    assert context["settings"]["thinking_level"] == "high"
    assert context["settings"]["include_thoughts"] is True
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


def test_chat_model_start_records_image_input_system_event_without_base64_duplication():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="lead_agent",
            model_name="kimi-k2.5-1",
        )

    callback.on_chat_model_start(
        {"name": "ChatModel"},
        [
            [
                HumanMessage(
                    content=[
                        {
                            "type": "text",
                            "text": "Attached uploaded image for visual inspection: demo.png (image/png, 10 KB, 20x20)",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/png;base64,QUJDREVGRw==",
                            },
                        },
                    ]
                )
            ]
        ],
        run_id=run_id,
    )

    append_calls = store.append_event.call_args_list
    assert append_calls[0].kwargs["run_type"] == "system"
    assert append_calls[0].kwargs["node_name"] == "ModelImageInputs"
    payload = append_calls[0].kwargs["payload"]["model_image_inputs"]
    assert payload["count"] == 1
    assert payload["images"][0]["source"] == "uploaded_attachment"
    assert payload["images"][0]["mime_type"] == "image/png"
    assert payload["images"][0]["base64_bytes"] == len("QUJDREVGRw==")
    assert payload["images"][0]["data_omitted"] is True
    assert "QUJDREVGRw==" not in str(payload)
    llm_payload = append_calls[1].kwargs["payload"]
    assert "QUJDREVGRw==" not in str(llm_payload)
    assert llm_payload["model_request"]["messages"][0]["content"][1]["image_url"]["data_omitted"] is True
    assert append_calls[1].kwargs["run_type"] == "llm"


def test_shrink_redacts_stringified_mcp_image_content_fields():
    image_data = "A" * 1024
    tool_message_repr = "content=[{'type': 'text', 'text': '{}'}, {'type': 'image', 'data': '" + image_data + "', 'mimeType': 'image/png'}]"

    result = _shrink(tool_message_repr, max_string_len=4096)

    assert image_data not in result
    assert "[omitted 1024 base64 bytes]" in result
    assert "'mimeType': 'image/png'" in result


def test_chat_model_start_classifies_read_file_image_blocks_without_base64_duplication():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="lead_agent",
            model_name="kimi-k2.5-1",
        )

    callback.on_chat_model_start(
        {"name": "ChatModel"},
        [
            [
                ToolMessage(
                    content=[create_image_block(base64="QUJDREVGRw==", mime_type="image/png")],
                    name="read_file",
                    tool_call_id="read-image-1",
                )
            ]
        ],
        run_id=run_id,
    )

    payload = store.append_event.call_args_list[0].kwargs["payload"]["model_image_inputs"]
    assert payload["images"][0]["source"] == "read_file_image"
    assert payload["images"][0]["tool_name"] == "read_file"
    assert payload["images"][0]["transport"] == "base64"
    assert payload["images"][0]["base64_bytes"] == len("QUJDREVGRw==")
    assert "QUJDREVGRw==" not in str(payload)


def test_model_image_inputs_does_not_depend_on_mcp_tool_name_prefix():
    payload = _extract_model_image_inputs(
        [
            {
                "role": "tool",
                "name": "mcp__docs__document_read",
                "content": [
                    {
                        "type": "image",
                        "base64": "QUJDREVGRw==",
                        "mime_type": "image/png",
                    }
                ],
            }
        ]
    )

    assert payload is not None
    assert payload["images"][0]["source"] == "tool_result_image"
    assert payload["images"][0]["tool_name"] == "mcp__docs__document_read"
    assert payload["images"][0]["data_omitted"] is True


def test_model_image_inputs_uses_structured_mcp_metadata_when_available():
    payload = _extract_model_image_inputs(
        [
            {
                "role": "tool",
                "name": "document_read",
                "additional_kwargs": {
                    "is_mcp": True,
                    "mcp_info": {"server_name": "docs", "tool_name": "document_read"},
                },
                "content": [
                    {
                        "type": "image",
                        "base64": "QUJDREVGRw==",
                        "mime_type": "image/png",
                    }
                ],
            }
        ]
    )

    assert payload is not None
    assert payload["images"][0]["source"] == "mcp_tool_result"
    assert payload["images"][0]["tool_name"] == "document_read"
    assert payload["images"][0]["data_omitted"] is True


def test_serialize_message_preserves_structured_mcp_metadata_for_trace_classification():
    message = ToolMessage(
        content=[create_image_block(base64="QUJDREVGRw==", mime_type="image/png")],
        name="document_read",
        tool_call_id="read-image-1",
        additional_kwargs={
            "is_mcp": True,
            "mcp_info": {"server_name": "docs", "tool_name": "document_read"},
        },
    )

    result = _serialize_message(message)

    assert result["additional_kwargs"]["is_mcp"] is True
    assert result["additional_kwargs"]["mcp_info"]["server_name"] == "docs"


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

    system_calls = [call.kwargs for call in store.append_event.call_args_list if call.kwargs["run_type"] == "system"]
    assert len(system_calls) == 1

    payload = system_calls[0]["payload"]["context_window"]
    assert payload["summary_applied"] is True
    assert payload["approx_input_tokens"] == 30448
    assert payload["max_input_tokens"] == 200_000
    assert payload["usage_ratio"] == 0.15224
    assert payload["last_summary"]["cutoff_index"] == 43
    assert payload["last_summary"]["file_path"] == "/conversation_history/thread-1.md"
    assert payload["last_summary"]["summary_preview"] == "summary text"


def test_on_tool_start_persists_structured_task_delegation_envelope():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="test",
            model_name="kimi-k2.5-1",
            metadata={
                "thread_id": "thread-1",
                "execution_backend": "sandbox",
                "original_user_input_preview": "translate doc",
                "original_user_input_digest": "digest-1",
            },
        )

    callback.on_tool_start(
        {"name": "task"},
        input_str='{"description":"translate chunk","prompt":"Translate /mnt/user-data/workspace/chunk_a.md to English and write the result.","subagent_type":"general-purpose"}',
        run_id=run_id,
        metadata={"execution_backend": "sandbox", "langgraph_request_id": "req-1"},
    )

    payload = store.append_event.call_args.kwargs["payload"]
    delegation = payload["delegation"]
    assert delegation["schema_version"] == 1
    assert delegation["task_session_id"] == str(run_id)
    assert delegation["effective_agent_name"] == "general-purpose"
    assert delegation["description"] == "translate chunk"
    assert "Translate /mnt/user-data/workspace/chunk_a.md" in delegation["prompt_preview"]
    assert delegation["validation_status"] == "valid"
    assert payload["lineage"]["execution_backend"] == "sandbox"
    assert payload["lineage"]["langgraph_request_id"] == "req-1"


def test_on_tool_error_persists_task_launch_failure_class():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="test",
            model_name="kimi-k2.5-1",
        )

    callback.on_tool_start(
        {"name": "task"},
        input_str='{"description":"do work","subagent_type":"general-purpose"}',
        run_id=run_id,
    )
    callback.on_tool_error(
        RuntimeError("1 validation error for task\nprompt\nField required"),
        run_id=run_id,
    )

    error_payload = store.append_event.call_args.kwargs["payload"]
    assert error_payload["delegation"]["validation_status"] == "invalid"
    assert error_payload["delegation"]["launch_failure_class"] == "missing_task_prompt"


def test_on_tool_start_persists_execute_contract_metadata():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="test",
            model_name="kimi-k2.5-1",
        )

    callback.on_tool_start(
        {"name": "execute"},
        input_str='{"command":"pytest -q","timeout":300}',
        run_id=run_id,
        metadata={
            "execution_backend": "sandbox",
            "execute_timeout_contract": {
                "default_timeout_seconds": 600,
                "max_timeout_seconds": 3600,
            },
        },
    )

    payload = store.append_event.call_args.kwargs["payload"]
    execution = payload["execution"]
    assert execution["launch_status"] == "started"
    assert execution["requested_timeout_seconds"] == 300
    assert execution["max_timeout_seconds"] == 3600
    assert execution["default_timeout_seconds_hint"] == 600


def test_on_tool_start_excludes_injected_runtime_from_tool_arguments():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="test",
            model_name="kimi-k2.5-1",
        )

    callback.on_tool_start(
        {"name": "document_list"},
        input_str=("{'runtime': ToolRuntime(state={'messages': [HumanMessage(content='User:\\n你有哪些知识库')]})}"),
        run_id=run_id,
        inputs={"runtime": "ToolRuntime(state={'messages': [...]})"},
    )

    payload = store.append_event.call_args.kwargs["payload"]
    assert payload["tool_call"]["arguments"] == {}
    assert "你有哪些知识库" not in str(payload["tool_call"]["arguments"])


def test_on_tool_start_keeps_structured_inputs_when_input_str_is_runtime_repr():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="test",
            model_name="kimi-k2.5-1",
        )

    callback.on_tool_start(
        {"name": "document_list"},
        input_str=("{'runtime': ToolRuntime(state={'messages': [HumanMessage(content='User:\\n你有哪些知识库')]})}"),
        run_id=run_id,
        inputs={"limit": 100, "runtime": "ToolRuntime(state={'messages': [...]})"},
    )

    payload = store.append_event.call_args.kwargs["payload"]
    assert payload["tool_call"]["arguments"] == {"limit": 100}


def test_on_tool_start_keeps_model_args_when_runtime_is_injected():
    store = MagicMock()
    run_id = uuid4()

    with patch("src.observability.callbacks.get_trace_store", return_value=store):
        callback = AgentTraceCallbackHandler(
            trace_id=str(uuid4()),
            user_id=None,
            thread_id="thread-1",
            agent_name="test",
            model_name="kimi-k2.5-1",
        )

    callback.on_tool_start(
        {"name": "document_list"},
        input_str='{"path":"guides","runtime":"ToolRuntime(state={})","tool_call_id":"call-1"}',
        run_id=run_id,
        inputs={
            "path": "guides",
            "runtime": "ToolRuntime(state={})",
            "tool_call_id": "call-1",
        },
    )

    payload = store.append_event.call_args.kwargs["payload"]
    assert payload["tool_call"]["arguments"] == {"path": "guides"}
