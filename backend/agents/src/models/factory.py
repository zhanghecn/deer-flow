import ipaddress
import logging
from typing import Any, Literal
from urllib.parse import urlparse

import anthropic
import httpx
from langchain.chat_models import BaseChatModel
from langchain_anthropic import ChatAnthropic
from langchain_anthropic._client_utils import (
    _AsyncHttpxClientWrapper,
    _SyncHttpxClientWrapper,
)

from src.agents.middlewares.retry_utils import (
    DEFAULT_PROVIDER_MAX_RETRIES,
    note_provider_retry_exception,
    note_provider_retry_request,
    note_provider_retry_response,
)
from src.config import get_tracing_config, is_tracing_enabled
from src.config.model_config import (
    ANTHROPIC_RUNTIME_CLASS,
    DEEPSEEK_RUNTIME_CLASS,
    GEMINI_RUNTIME_CLASS,
    OPENAI_RUNTIME_CLASS,
    ModelConfig,
    ModelReasoningConfig,
    ReasoningLevel,
)
from src.models.catalog import require_enabled_model
from src.reflection import resolve_class

logger = logging.getLogger(__name__)
DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS = 16384
ANTHROPIC_THINKING_OUTPUT_HEADROOM = 1024
EffortLevel = Literal["low", "medium", "high", "max"]
MODEL_CONFIG_EXCLUDE_FIELDS = {
    "use",
    "name",
    "display_name",
    "description",
    "max_input_tokens",
    "reasoning",
    "supports_vision",
}

OPENAI_REASONING_LEVEL_MAP: dict[EffortLevel, str] = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    # Our product-level `max` should map to the strongest official Responses
    # API effort. Official OpenAI exposes `xhigh`, while compatible gateways
    # often only mirror the older low/medium/high contract.
    "max": "xhigh",
}
ANTHROPIC_THINKING_BUDGET_MAP: dict[EffortLevel, int] = {
    "low": 1_024,
    "medium": 4_096,
    "high": 8_192,
    # Keep `max` under the default Anthropic-compatible max_tokens budget so
    # turning the profile up does not immediately trip provider validation.
    "max": 12_000,
}
GEMINI_THINKING_BUDGET_MAP: dict[EffortLevel, int] = {
    "low": 1_024,
    "medium": 4_096,
    "high": 8_192,
    "max": 16_384,
}
GEMINI_THINKING_LEVEL_MAP: dict[EffortLevel, str] = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    # Gemini 3+ tops out at `high`.
    "max": "high",
}


def _resolve_model_config(
    name: str | None,
    runtime_model_config: ModelConfig | dict | None,
) -> tuple[str, ModelConfig]:
    if runtime_model_config is not None:
        model_config = runtime_model_config if isinstance(runtime_model_config, ModelConfig) else ModelConfig.model_validate(runtime_model_config)

        if name is None:
            return model_config.name, model_config

        if model_config.name != name:
            logger.warning(
                "Runtime model config name '%s' does not match requested model '%s'; use runtime model config.",
                model_config.name,
                name,
            )
        return model_config.name, model_config

    if name is None:
        raise ValueError("Model name is required when `runtime_model_config` is not provided.") from None

    return name, require_enabled_model(name)


def _build_model_settings(model_config: ModelConfig) -> dict[str, Any]:
    return model_config.model_dump(
        exclude_none=True,
        exclude=MODEL_CONFIG_EXCLUDE_FIELDS,
    )


def _build_runtime_kwargs(
    *,
    max_output_tokens: int | None,
    temperature: float | None,
) -> dict[str, Any]:
    runtime_kwargs: dict[str, Any] = {}
    if max_output_tokens is not None:
        if max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be greater than zero.") from None
        # Runtime callers speak in the public `/v1` token-budget contract while
        # provider SDKs still expect `max_tokens`.
        runtime_kwargs["max_tokens"] = max_output_tokens
    if temperature is not None:
        runtime_kwargs["temperature"] = temperature
    return runtime_kwargs


def _resolve_reasoning_level(
    *,
    model_config: ModelConfig,
    thinking_enabled: bool,
    effort: EffortLevel | None,
) -> ReasoningLevel | None:
    if not thinking_enabled or model_config.reasoning is None:
        return None
    if effort is not None:
        return effort
    return model_config.reasoning.default_level


def _apply_reasoning_settings(
    *,
    model_config: ModelConfig,
    thinking_enabled: bool,
    effort: EffortLevel | None,
    model_settings: dict[str, Any],
    runtime_kwargs: dict[str, Any],
) -> None:
    reasoning = model_config.reasoning
    if reasoning is None:
        return

    level = _resolve_reasoning_level(
        model_config=model_config,
        thinking_enabled=thinking_enabled,
        effort=effort,
    )

    if reasoning.contract == "openai_responses":
        _apply_openai_reasoning_settings(
            reasoning=reasoning,
            model_config=model_config,
            level=level,
            runtime_kwargs=runtime_kwargs,
        )
        return
    if reasoning.contract == "anthropic_thinking":
        _apply_anthropic_reasoning_settings(
            reasoning=reasoning,
            level=level,
            model_settings=model_settings,
            runtime_kwargs=runtime_kwargs,
        )
        return
    if reasoning.contract == "gemini_budget":
        _apply_gemini_budget_reasoning_settings(level=level, runtime_kwargs=runtime_kwargs)
        return
    if reasoning.contract == "gemini_level":
        _apply_gemini_level_reasoning_settings(level=level, runtime_kwargs=runtime_kwargs)
        return
    if reasoning.contract == "deepseek_reasoner":
        # Reasoning is selected by the model family itself (for example R1 /
        # reasoner variants), so there is no provider-agnostic on/off or level
        # payload for the runtime to synthesize here.
        return

    raise ValueError(f"Unsupported reasoning contract: {reasoning.contract}") from None


def _apply_openai_reasoning_settings(
    *,
    reasoning: ModelReasoningConfig,
    model_config: ModelConfig,
    level: ReasoningLevel | None,
    runtime_kwargs: dict[str, Any],
) -> None:
    if level is None:
        if _uses_official_openai_responses_endpoint(model_config):
            # Official OpenAI reasoning models accept `reasoning.effort="none"`
            # to disable extended reasoning. OpenAI-compatible providers vary, so
            # custom endpoints fall back to omitting the reasoning block instead
            # of sending a maybe-invalid non-standard enum.
            runtime_kwargs["reasoning"] = {"effort": "none"}
        return

    if level == "auto":
        return

    if level == "max" and not _uses_official_openai_responses_endpoint(model_config):
        # Keep custom OpenAI-compatible gateways on the conservative enum set:
        # many providers proxy the older low/medium/high contract and would
        # reject OpenAI's newer `xhigh` level.
        runtime_kwargs["reasoning_effort"] = "high"
        return

    runtime_kwargs["reasoning_effort"] = OPENAI_REASONING_LEVEL_MAP[level]


def _uses_official_openai_responses_endpoint(model_config: ModelConfig) -> bool:
    base_url = getattr(model_config, "base_url", None)
    if not isinstance(base_url, str) or not base_url.strip():
        return True

    hostname = urlparse(base_url).hostname
    if hostname is None:
        return False
    normalized = hostname.strip().lower()
    return normalized == "api.openai.com" or normalized.endswith(".openai.com")


def _apply_anthropic_reasoning_settings(
    *,
    reasoning: ModelReasoningConfig,
    level: ReasoningLevel | None,
    model_settings: dict[str, Any],
    runtime_kwargs: dict[str, Any],
) -> None:
    if level is None:
        return

    thinking: dict[str, Any] = {"type": "enabled"}
    budget_tokens = _resolve_anthropic_thinking_budget(
        level=level,
        model_settings=model_settings,
        runtime_kwargs=runtime_kwargs,
    )
    if budget_tokens is not None:
        thinking["budget_tokens"] = budget_tokens

    model_settings["thinking"] = thinking


def _resolve_anthropic_thinking_budget(
    *,
    level: ReasoningLevel,
    model_settings: dict[str, Any],
    runtime_kwargs: dict[str, Any],
) -> int | None:
    if level == "auto":
        if "max_tokens" not in model_settings and "max_tokens" not in runtime_kwargs:
            runtime_kwargs["max_tokens"] = DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS
        return None

    resolved_max_tokens = _first_positive_int(
        runtime_kwargs.get("max_tokens"),
        model_settings.get("max_tokens"),
        model_settings.get("max_tokens_to_sample"),
    )
    if resolved_max_tokens is None:
        resolved_max_tokens = DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS
        runtime_kwargs["max_tokens"] = resolved_max_tokens

    budget = ANTHROPIC_THINKING_BUDGET_MAP[level]
    budget_ceiling = max(1, resolved_max_tokens - ANTHROPIC_THINKING_OUTPUT_HEADROOM)
    return min(budget, budget_ceiling)


def _first_positive_int(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int) and value > 0:
            return value
    return None


def _apply_gemini_budget_reasoning_settings(
    *,
    level: ReasoningLevel | None,
    runtime_kwargs: dict[str, Any],
) -> None:
    if level is None:
        # Gemini 2.5 disables thinking with a zero budget.
        runtime_kwargs["thinking_budget"] = 0
        return
    if level == "auto":
        runtime_kwargs["thinking_budget"] = -1
        return
    runtime_kwargs["thinking_budget"] = GEMINI_THINKING_BUDGET_MAP[level]


def _apply_gemini_level_reasoning_settings(
    *,
    level: ReasoningLevel | None,
    runtime_kwargs: dict[str, Any],
) -> None:
    if level is None:
        # Gemini 3+ exposes level-based controls, but not a clear disable enum.
        # Use the lightest supported level instead of sending a non-standard
        # value that would fail at request time.
        runtime_kwargs["thinking_level"] = "minimal"
        return
    if level == "auto":
        return
    runtime_kwargs["thinking_level"] = GEMINI_THINKING_LEVEL_MAP[level]


def _attach_langsmith_tracing(model_instance: BaseChatModel, name: str) -> None:
    if not is_tracing_enabled():
        return

    try:
        from langchain_core.tracers.langchain import LangChainTracer

        tracing_config = get_tracing_config()
        tracer = LangChainTracer(project_name=tracing_config.project)
        existing_callbacks = model_instance.callbacks or []
        model_instance.callbacks = [*existing_callbacks, tracer]
        logger.debug(
            "LangSmith tracing attached to model '%s' (project='%s')",
            name,
            tracing_config.project,
        )
    except Exception as exc:
        logger.warning(
            "Failed to attach LangSmith tracing to model '%s': %s",
            name,
            exc,
        )


def _attach_explicit_profile_limits(
    model_instance: BaseChatModel,
    model_config: ModelConfig,
) -> None:
    if model_config.max_input_tokens is None:
        return

    profile = getattr(model_instance, "profile", None)
    if not isinstance(profile, dict):
        profile = {}

    if not isinstance(profile.get("max_input_tokens"), int):
        profile["max_input_tokens"] = int(model_config.max_input_tokens)

    model_instance.profile = profile


def _should_bypass_env_proxy_for_base_url(base_url: object) -> bool:
    if not isinstance(base_url, str) or not base_url.strip():
        return False

    hostname = urlparse(base_url).hostname
    if hostname is None:
        return False

    normalized = hostname.strip().lower()
    if not normalized:
        return False
    if normalized == "localhost":
        return True
    # Container and cluster service hops often use single-label DNS names such
    # as `model-gateway`. Treat them like private addresses so model traffic
    # stays on the internal bridge network instead of leaking through host
    # HTTP proxy environment variables.
    if "." not in normalized:
        return True

    try:
        host_ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False

    return bool(host_ip.is_loopback or host_ip.is_private or host_ip.is_link_local)


def _resolve_anthropic_timeout(timeout: object) -> object:
    # Preserve the configured timeout contract exactly. Leaving the timeout
    # unset keeps Anthropic-compatible long requests alive instead of forcing a
    # repo-wide 120s cutoff that can abort legitimate multi-minute model turns.
    return timeout


def _attach_anthropic_http_retry_observers(model_instance: BaseChatModel) -> None:
    if not isinstance(model_instance, ChatAnthropic):
        return

    client_params = dict(model_instance._client_params)
    resolved_timeout = _resolve_anthropic_timeout(client_params.get("timeout"))
    client_params["timeout"] = resolved_timeout
    http_client_params: dict[str, Any] = {
        "base_url": client_params["base_url"],
        "timeout": resolved_timeout,
    }
    if model_instance.anthropic_proxy:
        http_client_params["proxy"] = model_instance.anthropic_proxy
    bypass_env_proxy = _should_bypass_env_proxy_for_base_url(client_params.get("base_url"))

    def on_request(request) -> None:
        note_provider_retry_request(request.method, str(request.url))

    def on_response(response) -> None:
        note_provider_retry_response(response.status_code, response.reason_phrase)

    async def on_async_request(request) -> None:
        note_provider_retry_request(request.method, str(request.url))

    async def on_async_response(response) -> None:
        note_provider_retry_response(response.status_code, response.reason_phrase)

    if bypass_env_proxy:
        sync_http_client = httpx.Client(
            base_url=http_client_params["base_url"],
            timeout=resolved_timeout,
            follow_redirects=True,
            trust_env=False,
            proxy=http_client_params.get("proxy"),
            event_hooks={
                "request": [on_request],
                "response": [on_response],
            },
        )
        async_http_client = httpx.AsyncClient(
            base_url=http_client_params["base_url"],
            timeout=resolved_timeout,
            follow_redirects=True,
            trust_env=False,
            proxy=http_client_params.get("proxy"),
            event_hooks={
                "request": [on_async_request],
                "response": [on_async_response],
            },
        )
    else:
        sync_http_client = _SyncHttpxClientWrapper(**http_client_params)
        sync_http_client.event_hooks["request"] = [
            *sync_http_client.event_hooks.get("request", []),
            on_request,
        ]
        sync_http_client.event_hooks["response"] = [
            *sync_http_client.event_hooks.get("response", []),
            on_response,
        ]

        async_http_client = _AsyncHttpxClientWrapper(**http_client_params)
        async_http_client.event_hooks["request"] = [
            *async_http_client.event_hooks.get("request", []),
            on_async_request,
        ]
        async_http_client.event_hooks["response"] = [
            *async_http_client.event_hooks.get("response", []),
            on_async_response,
        ]

    client_kwargs = {
        **client_params,
        "http_client": sync_http_client,
    }
    async_client_kwargs = {
        **client_params,
        "http_client": async_http_client,
    }

    try:
        model_instance._client = anthropic.Client(**client_kwargs)
        model_instance._async_client = anthropic.AsyncClient(**async_client_kwargs)
        if bypass_env_proxy:
            logger.info(
                "Anthropic model '%s' bypasses environment proxies for base_url '%s'.",
                getattr(model_instance, "model", "unknown"),
                client_params.get("base_url"),
            )
    except Exception as exc:
        note_provider_retry_exception(exc)
        logger.warning(
            "Failed to attach Anthropic HTTP retry observers to model '%s': %s",
            getattr(model_instance, "model", "unknown"),
            exc,
        )


def _apply_default_retry_budget(
    model_settings: dict[str, Any],
    runtime_kwargs: dict[str, Any],
) -> bool:
    if "max_retries" in model_settings or "max_retries" in runtime_kwargs:
        return False

    runtime_kwargs["max_retries"] = DEFAULT_PROVIDER_MAX_RETRIES
    return True


def _is_unsupported_kwarg_error(exc: TypeError, kwarg: str) -> bool:
    message = str(exc)
    patterns = (
        f"unexpected keyword argument '{kwarg}'",
        f'unexpected keyword argument "{kwarg}"',
        f"got an unexpected keyword argument '{kwarg}'",
        f'got an unexpected keyword argument "{kwarg}"',
    )
    return any(pattern in message for pattern in patterns)


def _instantiate_model(
    model_class: type[BaseChatModel],
    *,
    runtime_kwargs: dict[str, Any],
    model_settings: dict[str, Any],
    allow_retry_budget_fallback: bool,
) -> BaseChatModel:
    try:
        return model_class(**runtime_kwargs, **model_settings)
    except TypeError as exc:
        if not allow_retry_budget_fallback or "max_retries" not in runtime_kwargs or not _is_unsupported_kwarg_error(exc, "max_retries"):
            raise

        fallback_runtime_kwargs = dict(runtime_kwargs)
        fallback_runtime_kwargs.pop("max_retries", None)
        logger.info(
            "Model class '%s' does not accept max_retries; retry budget stays in middleware only.",
            getattr(model_class, "__name__", repr(model_class)),
        )
        return model_class(**fallback_runtime_kwargs, **model_settings)


def create_chat_model(
    *,
    name: str | None = None,
    thinking_enabled: bool = False,
    effort: EffortLevel | None = None,
    max_output_tokens: int | None = None,
    temperature: float | None = None,
    runtime_model_config: ModelConfig | dict | None = None,
) -> BaseChatModel:
    """Create a chat model instance from the config.

    Args:
        name: The name of the model to create. Must be explicitly provided unless runtime_model_config is provided.

    Returns:
        A chat model instance.
    """
    name, model_config = _resolve_model_config(name, runtime_model_config)
    model_class = resolve_class(model_config.use, BaseChatModel)
    model_settings_from_config = _build_model_settings(model_config)
    runtime_kwargs = _build_runtime_kwargs(
        max_output_tokens=max_output_tokens,
        temperature=temperature,
    )

    _apply_reasoning_settings(
        model_config=model_config,
        thinking_enabled=thinking_enabled,
        effort=effort,
        model_settings=model_settings_from_config,
        runtime_kwargs=runtime_kwargs,
    )
    # Keep model construction free of provider-specific tool-streaming forks.
    # Unified tool-call streaming behavior now belongs to the runtime event and
    # chunk-handling layers rather than `disable_streaming` model overrides.
    injected_retry_budget = _apply_default_retry_budget(
        model_settings_from_config,
        runtime_kwargs,
    )
    model_instance = _instantiate_model(
        model_class,
        runtime_kwargs=runtime_kwargs,
        model_settings=model_settings_from_config,
        allow_retry_budget_fallback=injected_retry_budget,
    )

    _attach_explicit_profile_limits(model_instance, model_config)
    _attach_anthropic_http_retry_observers(model_instance)
    _attach_langsmith_tracing(model_instance, name)
    return model_instance
