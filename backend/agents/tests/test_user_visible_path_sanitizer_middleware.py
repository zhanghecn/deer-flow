from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage

from src.agents.middlewares.user_visible_path_sanitizer_middleware import (
    UserVisiblePathSanitizerMiddleware,
    sanitize_user_visible_content,
    sanitize_user_visible_text,
)


def test_sanitize_user_visible_text_replaces_presented_output_paths_with_filename():
    content = (
        "完整文案已保存至 /mnt/user-data/outputs/ai-customer-support-landing-page-copy.md，"
        "包含详细的模块说明。"
    )

    sanitized = sanitize_user_visible_text(
        content,
        artifacts=["/mnt/user-data/outputs/ai-customer-support-landing-page-copy.md"],
    )

    assert "/mnt/user-data/" not in sanitized
    assert sanitized == "完整文案已作为附件提供（`ai-customer-support-landing-page-copy.md`），包含详细的模块说明。"


def test_sanitize_user_visible_content_handles_text_blocks():
    content = [
        {
            "type": "text",
            "text": "See /mnt/user-data/workspace/research-plan.json before continuing.",
        }
    ]

    sanitized = sanitize_user_visible_content(content)

    assert sanitized == [{"type": "text", "text": "See `research-plan.json` before continuing."}]


def test_wrap_model_call_sanitizes_ai_message_content_from_request_state():
    middleware = UserVisiblePathSanitizerMiddleware()
    request = ModelRequest(
        model=None,
        messages=[],
        state={
            "messages": [],
            "artifacts": ["/mnt/user-data/outputs/demo deck.pptx"],
        },
    )

    response = middleware.wrap_model_call(
        request,
        lambda _request: ModelResponse(
            result=[
                AIMessage(
                    content="Presentation saved to /mnt/user-data/outputs/demo deck.pptx for review.",
                )
            ]
        ),
    )

    assert isinstance(response, ModelResponse)
    assert response.result[0].text == "Presentation attached as `demo deck.pptx` for review."
