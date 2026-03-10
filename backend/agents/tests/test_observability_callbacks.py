from src.observability.callbacks import _extract_model_request_context, _shrink


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
