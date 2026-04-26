from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents import create_agent
from langchain.agents.middleware.types import ExtendedModelResponse, ModelRequest, ModelResponse
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver

from src.agents.middlewares.context_window_middleware import ContextWindowMiddleware
from src.config.summarization_config import (
    ContextSize,
    SummarizationConfig,
    get_summarization_config,
    set_summarization_config,
)


def _clone_summarization_config(config: SummarizationConfig) -> SummarizationConfig:
    return SummarizationConfig(**config.model_dump())


def _set_test_summarization_config(**overrides) -> SummarizationConfig:
    config = _clone_summarization_config(get_summarization_config())
    for key, value in overrides.items():
        setattr(config, key, value)
    set_summarization_config(config)
    return config


class TestContextWindowMiddleware:
    def setup_method(self):
        self._original_config = _clone_summarization_config(get_summarization_config())

    def teardown_method(self):
        set_summarization_config(self._original_config)

    def test_wrap_model_call_records_active_prompt_usage_without_summary(self):
        _set_test_summarization_config(
            enabled=True,
            trigger=[ContextSize(type="fraction", value=0.95)],
            keep=ContextSize(type="messages", value=2),
        )
        middleware = ContextWindowMiddleware()
        model = MagicMock()
        model.profile = {"max_input_tokens": 200_000}

        request = ModelRequest(
            model=model,
            messages=[
                HumanMessage(content="Build a landing page about Pi Day."),
                AIMessage(content="I will first outline the structure."),
            ],
            system_message=SystemMessage(content="You are helpful."),
            tools=[],
            runtime=MagicMock(),
            state={
                "messages": [
                    HumanMessage(content="Build a landing page about Pi Day."),
                    AIMessage(content="I will first outline the structure."),
                ]
            },
        )

        response = middleware.wrap_model_call(
            request,
            lambda _request: ModelResponse(result=[AIMessage(content="Done")]),
        )

        assert isinstance(response, ExtendedModelResponse)
        payload = response.command.update["context_window"]
        assert payload["summary_applied"] is False
        assert payload["max_input_tokens"] == 200_000
        assert payload["raw_message_count"] == 2
        assert payload["effective_message_count"] == 2
        assert payload["approx_input_tokens"] > 0
        assert payload["usage_ratio"] > 0
        assert payload["trigger_thresholds"][0]["type"] == "fraction"
        assert payload["trigger_thresholds"][0]["matched"] is False

    def test_wrap_model_call_records_before_and_after_tokens_when_summary_is_applied(self):
        _set_test_summarization_config(
            enabled=True,
            trigger=[ContextSize(type="messages", value=3)],
            keep=ContextSize(type="messages", value=1),
        )
        middleware = ContextWindowMiddleware()
        model = MagicMock()
        model.profile = {"max_input_tokens": 100_000}

        summary_message = HumanMessage(
            content=(
                "You are in the middle of a conversation that has been summarized.\n\n"
                "The full conversation history has been saved to /conversation_history/thread-1.md "
                "should you need to refer back to it for details.\n\n"
                "A condensed summary follows:\n\n"
                "<summary>\nSummary of the first two turns.\n</summary>"
            ),
            additional_kwargs={"lc_source": "summarization"},
        )

        request = ModelRequest(
            model=model,
            messages=[
                summary_message,
                HumanMessage(content="Now turn that into a PPT outline."),
            ],
            system_message=SystemMessage(content="You are helpful."),
            tools=[],
            runtime=MagicMock(),
            state={
                "messages": [
                    HumanMessage(content="Surprise me"),
                    AIMessage(content="Here is a Pi Day landing page plan. " * 200),
                    HumanMessage(content="Now turn that into a PPT outline."),
                ]
            },
        )

        response = middleware.wrap_model_call(
            request,
            lambda _request: ModelResponse(result=[AIMessage(content="Done")]),
        )

        assert isinstance(response, ExtendedModelResponse)
        payload = response.command.update["context_window"]
        assert payload["summary_applied"] is True
        assert payload["triggered"] is True
        assert payload["summary_count"] == 1
        assert payload["effective_message_count"] == 3
        assert payload["effective_message_count_after_summary"] == 2
        assert payload["approx_input_tokens"] > payload["approx_input_tokens_after_summary"]
        assert payload["usage_ratio"] > payload["usage_ratio_after_summary"]
        assert payload["trigger_reasons"] == ["3 messages"]
        assert payload["last_summary"]["file_path"] == "/conversation_history/thread-1.md"
        assert payload["last_summary"]["summary_preview"] == "Summary of the first two turns."
        assert payload["last_summary"]["summarized_message_count"] == 2
        assert payload["last_summary"]["preserved_message_count"] == 1
        assert payload["last_summary"]["state_cutoff_index"] == 2

    def test_wrap_model_call_derives_existing_summary_when_thread_has_prior_event(self):
        _set_test_summarization_config(
            enabled=True,
            trigger=[ContextSize(type="fraction", value=0.95)],
            keep=ContextSize(type="messages", value=2),
        )
        middleware = ContextWindowMiddleware()
        model = MagicMock()
        model.profile = {"max_input_tokens": 50_000}

        prior_summary_message = HumanMessage(
            content=(
                "You are in the middle of a conversation that has been summarized.\n\n"
                "The full conversation history has been saved to /conversation_history/thread-9.md "
                "should you need to refer back to it for details.\n\n"
                "A condensed summary follows:\n\n"
                "<summary>\nPrevious conversation summary.\n</summary>"
            ),
            additional_kwargs={"lc_source": "summarization"},
        )

        request = ModelRequest(
            model=model,
            messages=[
                prior_summary_message,
                HumanMessage(content="Continue with the next section."),
            ],
            system_message=SystemMessage(content="You are helpful."),
            tools=[],
            runtime=MagicMock(),
            state={
                "messages": [
                    HumanMessage(content="First request"),
                    AIMessage(content="First answer"),
                    HumanMessage(content="Continue with the next section."),
                ],
                "_summarization_event": {
                    "cutoff_index": 2,
                    "summary_message": prior_summary_message,
                    "file_path": "/conversation_history/thread-9.md",
                },
            },
        )

        response = middleware.wrap_model_call(
            request,
            lambda _request: ModelResponse(result=[AIMessage(content="Done")]),
        )

        assert isinstance(response, ExtendedModelResponse)
        payload = response.command.update["context_window"]
        assert payload["summary_applied"] is False
        assert payload["summary_count"] == 1
        assert payload["effective_message_count"] == 2
        assert payload["last_summary"]["file_path"] == "/conversation_history/thread-9.md"
        assert payload["last_summary"]["summary_preview"] == "Previous conversation summary."

    def test_wrap_model_call_records_microcompact_tool_result_savings(self):
        _set_test_summarization_config(
            enabled=True,
            trigger=[ContextSize(type="messages", value=100)],
            keep=ContextSize(type="messages", value=2),
        )
        middleware = ContextWindowMiddleware()
        model = MagicMock()
        model.profile = None

        long_result = "document_search result " + ("甲辰 " * 2000)
        messages = [
            AIMessage(
                content="Searching",
                tool_calls=[
                    {
                        "id": "tc-search",
                        "name": "document_search",
                        "args": {"pattern": "甲辰"},
                    }
                ],
            ),
            ToolMessage(content=long_result, name="document_search", tool_call_id="tc-search"),
        ]
        messages.extend(HumanMessage(content=f"Follow-up {index}") for index in range(23))

        request = ModelRequest(
            model=model,
            messages=messages,
            system_message=SystemMessage(content="You are helpful."),
            tools=[],
            runtime=MagicMock(),
            state={"messages": messages},
        )

        response = middleware.wrap_model_call(
            request,
            lambda _request: ModelResponse(result=[AIMessage(content="Done")]),
        )

        assert isinstance(response, ExtendedModelResponse)
        payload = response.command.update["context_window"]
        assert payload["summary_applied"] is False
        assert payload["microcompact_applied"] is True
        assert payload["microcompacted_tool_result_count"] == 1
        assert payload["microcompact_original_chars"] > payload["microcompact_compacted_chars"]
        assert payload["approx_input_tokens_after_microcompact"] < payload["approx_input_tokens"]

    def test_state_schema_persists_context_window_into_agent_state(self):
        _set_test_summarization_config(
            enabled=True,
            trigger=[ContextSize(type="fraction", value=0.95)],
            keep=ContextSize(type="messages", value=2),
        )

        model = FakeMessagesListChatModel(responses=[AIMessage(content="Done")])
        model.profile = {"max_input_tokens": 100_000}

        agent = create_agent(
            model,
            middleware=[ContextWindowMiddleware()],
            checkpointer=MemorySaver(),
        )
        config = {"configurable": {"thread_id": "thread-context-window"}}

        result = agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Build a landing page about Pi Day.",
                    }
                ]
            },
            config,
        )
        state = agent.get_state(config).values

        assert result["context_window"]["summary_applied"] is False
        assert result["context_window"]["max_input_tokens"] == 100_000
        assert state["context_window"] == result["context_window"]
