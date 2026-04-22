from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ModelConfig(BaseModel):
    """Config section for a model"""

    name: str = Field(..., description="Unique name for the model")
    display_name: str | None = Field(..., default_factory=lambda: None, description="Display name for the model")
    description: str | None = Field(..., default_factory=lambda: None, description="Description for the model")
    use: str = Field(
        ...,
        description="Class path of the model provider(e.g. langchain_openai.ChatOpenAI)",
    )
    model: str = Field(..., description="Model name")
    model_config = ConfigDict(extra="allow")
    supports_thinking: bool = Field(default_factory=lambda: False, description="Whether the model supports thinking")
    supports_effort: bool = Field(default_factory=lambda: False, description="Whether the model supports effort")
    when_thinking_enabled: dict | None = Field(
        default_factory=lambda: None,
        description="Extra settings to be passed to the model when thinking is enabled",
    )
    supports_vision: bool = Field(default_factory=lambda: False, description="Whether the model supports vision/image inputs")
    max_input_tokens: int | None = Field(
        default=None,
        description="Optional explicit context-window size used when the provider model does not expose max_input_tokens in its profile.",
    )

    @model_validator(mode="before")
    @classmethod
    def reject_legacy_effort_keys(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        legacy_keys = [
            key for key in ("supports_reasoning_effort", "reasoning_effort")
            if key in value
        ]
        if legacy_keys:
            # The runtime now has a single canonical effort contract. Failing
            # explicitly keeps stale profile rows from silently reintroducing
            # the old key family through model validation.
            raise ValueError(
                "Model config uses retired effort keys: "
                + ", ".join(legacy_keys)
                + ". Use `supports_effort` on the model profile and per-run `effort` at execution time."
            ) from None
        return value
