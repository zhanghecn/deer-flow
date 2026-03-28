import logging
import ipaddress
from typing import Any
from urllib.parse import urlparse

import anthropic
import httpx
from langchain.chat_models import BaseChatModel
from langchain_anthropic import ChatAnthropic
from langchain_anthropic._client_utils import (
    _AsyncHttpxClientWrapper,
    _SyncHttpxClientWrapper,
)

from src.config import get_tracing_config, is_tracing_enabled
from src.config.model_config import ModelConfig
from src.config.runtime_db import get_runtime_db_store
from src.reflection import resolve_class
from src.agents.middlewares.retry_utils import (
    DEFAULT_PROVIDER_MAX_RETRIES,
    note_provider_retry_exception,
    note_provider_retry_request,
    note_provider_retry_response,
)

logger = logging.getLogger(__name__)
DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS = 16384
DEFAULT_REASONING_EFFORT = "high"
MINIMAL_REASONING_EFFORT = "minimal"
ANTHROPIC_CHAT_MODEL_CLASS = "langchain_anthropic:ChatAnthropic"
MODEL_CONFIG_EXCLUDE_FIELDS = {
    "use",
    "name",
    "display_name",
    "description",
    "max_input_tokens",
    "supports_thinking",
    "supports_reasoning_effort",
    "when_thinking_enabled",
    "supports_vision",
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

    model_config = get_runtime_db_store().get_model(name)
    if model_config is None:
        raise ValueError(f"Model {name} not found in database or is disabled") from None

    return name, model_config


def _build_model_settings(model_config: ModelConfig) -> dict[str, Any]:
    return model_config.model_dump(
        exclude_none=True,
        exclude=MODEL_CONFIG_EXCLUDE_FIELDS,
    )


def _apply_enabled_thinking_settings(
    *,
    name: str,
    model_config: ModelConfig,
    model_settings: dict[str, Any],
    runtime_kwargs: dict[str, Any],
) -> None:
    if model_config.when_thinking_enabled is not None:
        if not model_config.supports_thinking:
            raise ValueError(f"Model {name} does not support thinking. Set `supports_thinking` to true in your runtime model configuration.") from None
        model_settings.update(model_config.when_thinking_enabled)

    if model_config.use == ANTHROPIC_CHAT_MODEL_CLASS and "max_tokens" not in model_settings and "max_tokens" not in runtime_kwargs:
        runtime_kwargs["max_tokens"] = DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS

    if model_config.supports_reasoning_effort and "reasoning_effort" not in runtime_kwargs:
        runtime_kwargs["reasoning_effort"] = DEFAULT_REASONING_EFFORT


def _apply_disabled_thinking_settings(
    model_config: ModelConfig,
    runtime_kwargs: dict[str, Any],
) -> None:
    if not _uses_extra_body_thinking_toggle(model_config):
        return

    runtime_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    runtime_kwargs["reasoning_effort"] = MINIMAL_REASONING_EFFORT


def _uses_extra_body_thinking_toggle(model_config: ModelConfig) -> bool:
    thinking_config = (model_config.when_thinking_enabled or {}).get("extra_body", {})
    thinking = thinking_config.get("thinking", {})
    return bool(thinking.get("type"))


def _apply_thinking_settings(
    *,
    name: str,
    model_config: ModelConfig,
    thinking_enabled: bool,
    model_settings: dict[str, Any],
    runtime_kwargs: dict[str, Any],
) -> None:
    if thinking_enabled:
        _apply_enabled_thinking_settings(
            name=name,
            model_config=model_config,
            model_settings=model_settings,
            runtime_kwargs=runtime_kwargs,
        )
    else:
        _apply_disabled_thinking_settings(model_config, runtime_kwargs)

    if not model_config.supports_reasoning_effort:
        runtime_kwargs.pop("reasoning_effort", None)


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

    try:
        host_ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False

    return bool(
        host_ip.is_loopback
        or host_ip.is_private
        or host_ip.is_link_local
    )


def _attach_anthropic_http_retry_observers(model_instance: BaseChatModel) -> None:
    if not isinstance(model_instance, ChatAnthropic):
        return

    client_params = dict(model_instance._client_params)
    http_client_params: dict[str, Any] = {
        "base_url": client_params["base_url"],
    }
    if "timeout" in client_params:
        http_client_params["timeout"] = client_params["timeout"]
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
        explicit_timeout = http_client_params.get("timeout")
        client_timeout = explicit_timeout if explicit_timeout is not None else 600.0
        sync_http_client = httpx.Client(
            base_url=http_client_params["base_url"],
            timeout=client_timeout,
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
            timeout=client_timeout,
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
    name: str | None = None,
    thinking_enabled: bool = False,
    runtime_model_config: ModelConfig | dict | None = None,
    **kwargs,
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
    runtime_kwargs = dict(kwargs)

    _apply_thinking_settings(
        name=name,
        model_config=model_config,
        thinking_enabled=thinking_enabled,
        model_settings=model_settings_from_config,
        runtime_kwargs=runtime_kwargs,
    )
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
