import logging

from langchain.chat_models import BaseChatModel

from src.config import get_tracing_config, is_tracing_enabled
from src.config.model_config import ModelConfig
from src.config.runtime_db import get_runtime_db_store
from src.reflection import resolve_class

logger = logging.getLogger(__name__)


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
    model_config: ModelConfig | None = None

    if runtime_model_config is not None:
        if isinstance(runtime_model_config, ModelConfig):
            model_config = runtime_model_config
        else:
            model_config = ModelConfig.model_validate(runtime_model_config)

        if name is None:
            name = model_config.name
        elif model_config.name != name:
            logger.warning("Runtime model config name '%s' does not match requested model '%s'; use runtime model config.", model_config.name, name)
            name = model_config.name
    else:
        if name is None:
            raise ValueError(
                "Model name is required when `runtime_model_config` is not provided."
            ) from None
        model_config = get_runtime_db_store().get_model(name)
        if model_config is None:
            raise ValueError(f"Model {name} not found in database or is disabled") from None

    assert model_config is not None
    model_class = resolve_class(model_config.use, BaseChatModel)
    model_settings_from_config = model_config.model_dump(
        exclude_none=True,
        exclude={
            "use",
            "name",
            "display_name",
            "description",
            "supports_thinking",
            "supports_reasoning_effort",
            "when_thinking_enabled",
            "supports_vision",
        },
    )
    if thinking_enabled and model_config.when_thinking_enabled is not None:
        if not model_config.supports_thinking:
            raise ValueError(
                f"Model {name} does not support thinking. Set `supports_thinking` to true in your runtime model configuration."
            ) from None
        model_settings_from_config.update(model_config.when_thinking_enabled)
    if not thinking_enabled and model_config.when_thinking_enabled and model_config.when_thinking_enabled.get("extra_body", {}).get("thinking", {}).get("type"):
        kwargs.update({"extra_body": {"thinking": {"type": "disabled"}}})
        kwargs.update({"reasoning_effort": "minimal"})
    if not model_config.supports_reasoning_effort:
        kwargs.pop("reasoning_effort", None)
    model_instance = model_class(**kwargs, **model_settings_from_config)

    if is_tracing_enabled():
        try:
            from langchain_core.tracers.langchain import LangChainTracer

            tracing_config = get_tracing_config()
            tracer = LangChainTracer(
                project_name=tracing_config.project,
            )
            existing_callbacks = model_instance.callbacks or []
            model_instance.callbacks = [*existing_callbacks, tracer]
            logger.debug(f"LangSmith tracing attached to model '{name}' (project='{tracing_config.project}')")
        except Exception as e:
            logger.warning(f"Failed to attach LangSmith tracing to model '{name}': {e}")
    return model_instance
