from src.agents.lead_agent import agent as lead_agent_module
from src.agents.middlewares.runtime_command_middleware import RuntimeCommandMiddleware
from src.config.model_config import ModelConfig, ModelReasoningConfig


def _model() -> ModelConfig:
    return ModelConfig(
        name="safe-model",
        display_name="safe-model",
        description=None,
        use="langchain_openai:ChatOpenAI",
        model="safe-model",
        reasoning=ModelReasoningConfig(contract="openai_responses"),
        supports_vision=False,
    )


def test_build_openagents_middlewares_excludes_authoring_guard():
    middlewares = lead_agent_module._build_openagents_middlewares(_model())

    assert "AuthoringGuardMiddleware" not in {
        middleware.__class__.__name__ for middleware in middlewares
    }
    assert any(isinstance(middleware, RuntimeCommandMiddleware) for middleware in middlewares)
