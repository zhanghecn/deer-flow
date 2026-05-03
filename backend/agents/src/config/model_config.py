from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ReasoningLevel = Literal["auto", "low", "medium", "high", "max"]
ReasoningContract = Literal[
    "openai_responses",
    "anthropic_thinking",
    "gemini_budget",
    "gemini_level",
    "deepseek_reasoner",
]

LEGACY_REASONING_KEYS = (
    "supports_thinking",
    "supports_effort",
    "when_thinking_enabled",
    "reasoning_effort",
    "supports_reasoning_effort",
)

OPENAI_RUNTIME_CLASS = "langchain_openai:ChatOpenAI"
ANTHROPIC_RUNTIME_CLASS = "langchain_anthropic:ChatAnthropic"
GEMINI_RUNTIME_CLASS = "langchain_google_genai:ChatGoogleGenerativeAI"
DEEPSEEK_RUNTIME_CLASS = "langchain_deepseek:ChatDeepSeek"


class ModelReasoningConfig(BaseModel):
    """Canonical persisted reasoning contract for one provider model profile."""

    model_config = ConfigDict(extra="forbid")

    contract: ReasoningContract = Field(
        ...,
        description="Internal runtime mapping contract. The admin UI should infer this rather than expose provider payload details.",
    )
    default_level: ReasoningLevel = Field(
        default="auto",
        description="Default reasoning level to use for thinking-enabled turns when the caller does not send an explicit effort override.",
    )

    @model_validator(mode="after")
    def validate_contract_defaults(self) -> "ModelReasoningConfig":
        if self.contract == "deepseek_reasoner" and self.default_level != "auto":
            raise ValueError(
                "DeepSeek reasoner models do not support generic effort levels. Use `default_level=\"auto\"`."
            ) from None
        return self

    @property
    def supports_effort(self) -> bool:
        return self.contract != "deepseek_reasoner"


class ModelConfig(BaseModel):
    """Config section for a model."""

    name: str = Field(..., description="Unique name for the model")
    display_name: str | None = Field(..., default_factory=lambda: None, description="Display name for the model")
    description: str | None = Field(..., default_factory=lambda: None, description="Description for the model")
    use: str = Field(
        ...,
        description="Class path of the model provider(e.g. langchain_openai.ChatOpenAI)",
    )
    model: str = Field(..., description="Model name")
    model_config = ConfigDict(extra="allow")
    reasoning: ModelReasoningConfig | None = Field(
        default=None,
        description="Canonical reasoning support and default level for the model.",
    )
    supports_vision: bool = Field(default_factory=lambda: False, description="Whether the model supports vision/image inputs")
    max_input_tokens: int | None = Field(
        default=None,
        description="Optional explicit context-window size used when the provider model does not expose max_input_tokens in its profile.",
    )

    @model_validator(mode="before")
    @classmethod
    def reject_legacy_reasoning_keys(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        legacy_keys = [key for key in LEGACY_REASONING_KEYS if key in value]
        if legacy_keys:
            # Hard-fail old profile keys so the runtime reads a single reasoning
            # contract. Persisted rows must be migrated instead of keeping two
            # config shapes alive in model construction code.
            raise ValueError(
                "Model config uses retired reasoning keys: "
                + ", ".join(sorted(legacy_keys))
                + ". Migrate the row onto `reasoning`."
            ) from None
        if "effort" in value:
            raise ValueError(
                "Model config uses runtime-only key `effort`. Persist default reasoning under `reasoning.default_level` instead."
            ) from None
        return value

    @property
    def supports_thinking(self) -> bool:
        return self.reasoning is not None

    @property
    def supports_effort(self) -> bool:
        return self.reasoning.supports_effort if self.reasoning is not None else False


def has_legacy_reasoning_config(value: Mapping[str, Any] | None) -> bool:
    if not isinstance(value, Mapping):
        return False
    return any(key in value for key in LEGACY_REASONING_KEYS)


def migrate_legacy_model_config_payload(value: Mapping[str, Any]) -> dict[str, Any]:
    """Return the canonical persisted config for a legacy model row.

    This helper is intentionally storage-focused. Runtime validation still
    rejects legacy keys; callers should persist the returned payload before
    asking `ModelConfig` to validate it.
    """

    payload = dict(value)
    reasoning = _build_canonical_reasoning_from_legacy(payload)

    for key in LEGACY_REASONING_KEYS:
        payload.pop(key, None)

    if reasoning is not None:
        payload["reasoning"] = reasoning.model_dump()
    else:
        payload.pop("reasoning", None)

    return payload


def _build_canonical_reasoning_from_legacy(
    payload: Mapping[str, Any],
) -> ModelReasoningConfig | None:
    contract = _infer_reasoning_contract(payload)
    if contract is None:
        return None

    return ModelReasoningConfig(
        contract=contract,
        default_level=_infer_default_reasoning_level(payload, contract),
    )


def _infer_reasoning_contract(payload: Mapping[str, Any]) -> ReasoningContract | None:
    reasoning = payload.get("reasoning")
    if isinstance(reasoning, Mapping):
        try:
            return ModelReasoningConfig.model_validate(reasoning).contract
        except Exception:
            return None

    runtime_class = str(payload.get("use") or "").strip()
    model_name = str(payload.get("model") or "").strip().lower()

    supports_thinking = payload.get("supports_thinking") is True
    supports_effort = payload.get("supports_effort") is True
    has_thinking_payload = _extract_legacy_thinking_payload(payload) is not None

    if not supports_thinking and not supports_effort and not has_thinking_payload:
        if runtime_class == DEEPSEEK_RUNTIME_CLASS and _is_deepseek_reasoner_model(model_name):
            return "deepseek_reasoner"
        return None

    if runtime_class == OPENAI_RUNTIME_CLASS:
        return "openai_responses"
    if runtime_class == ANTHROPIC_RUNTIME_CLASS:
        return "anthropic_thinking"
    if runtime_class == GEMINI_RUNTIME_CLASS:
        return "gemini_level" if _uses_gemini_level_contract(model_name) else "gemini_budget"
    if runtime_class == DEEPSEEK_RUNTIME_CLASS:
        return "deepseek_reasoner" if _is_deepseek_reasoner_model(model_name) else None

    return None


def _infer_default_reasoning_level(
    payload: Mapping[str, Any],
    contract: ReasoningContract,
) -> ReasoningLevel:
    if contract == "deepseek_reasoner":
        return "auto"

    for key in ("reasoning_effort", "effort"):
        legacy_effort = _normalize_reasoning_level(payload.get(key))
        if legacy_effort is not None:
            return legacy_effort

    thinking_payload = _extract_legacy_thinking_payload(payload)
    if isinstance(thinking_payload, Mapping):
        thinking_type = str(thinking_payload.get("type") or "").strip().lower()
        if thinking_type == "adaptive":
            return "auto"

        budget = thinking_payload.get("budget_tokens")
        if budget is None:
            budget = thinking_payload.get("budgetTokens")
        budget_level = _map_budget_to_level(budget)
        if budget_level is not None:
            return budget_level

        if thinking_type == "enabled":
            return "auto"

    # Legacy `supports_effort=true` caused an implicit runtime default of `high`.
    # That behavior was the bug the admin cleanup removes, so migrated rows use
    # the provider default unless an explicit level was previously stored.
    return "auto"


def _extract_legacy_thinking_payload(
    payload: Mapping[str, Any],
) -> Mapping[str, Any] | None:
    thinking_config = payload.get("when_thinking_enabled")
    if not isinstance(thinking_config, Mapping):
        return None

    direct_thinking = thinking_config.get("thinking")
    if isinstance(direct_thinking, Mapping):
        return direct_thinking

    extra_body = thinking_config.get("extra_body")
    if not isinstance(extra_body, Mapping):
        return None

    nested_thinking = extra_body.get("thinking")
    if isinstance(nested_thinking, Mapping):
        return nested_thinking
    return None


def _map_budget_to_level(value: Any) -> ReasoningLevel | None:
    if not isinstance(value, int) or value <= 0:
        return None
    if value <= 2_000:
        return "low"
    if value <= 8_000:
        return "medium"
    if value <= 16_000:
        return "high"
    return "max"


def _normalize_reasoning_level(value: Any) -> ReasoningLevel | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {"auto", "low", "medium", "high", "max"}:
        return normalized  # type: ignore[return-value]
    return None


def _uses_gemini_level_contract(model_name: str) -> bool:
    normalized = model_name.strip().lower()
    return normalized.startswith("gemini-3")


def _is_deepseek_reasoner_model(model_name: str) -> bool:
    normalized = model_name.strip().lower()
    if not normalized or normalized.endswith("-none"):
        return False
    # New API exposes DeepSeek V4 thinking variants through an OpenAI-compatible
    # endpoint, but the runtime still has to preserve DeepSeek reasoning state.
    return (
        "reasoner" in normalized
        or normalized.startswith("deepseek-r1")
        or normalized.startswith("deepseek-v4")
    )
