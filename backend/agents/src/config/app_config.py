import json
import logging
import os
from pathlib import Path
from typing import Any, Self

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

from src.config.extensions_config import ExtensionsConfig
from src.config.memory_config import load_memory_config_from_dict
from src.config.model_config import ModelConfig
from src.config.sandbox_config import SandboxConfig
from src.config.skills_config import SkillsConfig
from src.config.subagents_config import load_subagents_config_from_dict
from src.config.summarization_config import load_summarization_config_from_dict
from src.config.title_config import load_title_config_from_dict
from src.config.tool_config import ToolConfig, ToolGroupConfig

load_dotenv()
logger = logging.getLogger(__name__)


class AppConfig(BaseModel):
    """Config for the OpenAgents application"""

    models: list[ModelConfig] = Field(default_factory=list, description="Available models")
    sandbox: SandboxConfig = Field(description="Sandbox configuration")
    tools: list[ToolConfig] = Field(default_factory=list, description="Available tools")
    tool_groups: list[ToolGroupConfig] = Field(default_factory=list, description="Available tool groups")
    skills: SkillsConfig = Field(default_factory=SkillsConfig, description="Skills configuration")
    extensions: ExtensionsConfig = Field(default_factory=ExtensionsConfig, description="Extensions configuration (MCP servers and skills state)")
    model_config = ConfigDict(extra="allow", frozen=False)

    @classmethod
    def resolve_config_path(cls, config_path: str | None = None) -> Path | None:
        """Resolve the config file path.

        Priority:
        1. If provided `config_path` argument, use it.
        2. If provided `OPENAGENTS_CONFIG_PATH` environment variable, use it.
        3. Otherwise, first check the `config.yaml` in the current directory, then fallback to `config.yaml` in the parent directory.
           If neither exists, return None (runtime fallback mode).
        """
        if config_path:
            path = Path(config_path)
            if not Path.exists(path):
                raise FileNotFoundError(f"Config file specified by param `config_path` not found at {path}")
            return path
        elif os.getenv("OPENAGENTS_CONFIG_PATH"):
            path = Path(os.getenv("OPENAGENTS_CONFIG_PATH"))
            if not Path.exists(path):
                raise FileNotFoundError(f"Config file specified by environment variable `OPENAGENTS_CONFIG_PATH` not found at {path}")
            return path
        else:
            # Check if the config.yaml is in the current directory
            path = Path(os.getcwd()) / "config.yaml"
            if not path.exists():
                # Check if the config.yaml is in the parent directory of CWD
                path = Path(os.getcwd()).parent / "config.yaml"
                if not path.exists():
                    return None
            return path

    @classmethod
    def _load_models_from_models_json_env(cls) -> list[ModelConfig]:
        """Load models from OPENAGENTS_MODELS_JSON (explicit runtime source)."""
        raw = os.getenv("OPENAGENTS_MODELS_JSON")
        if not raw:
            return []
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning("OPENAGENTS_MODELS_JSON is not valid JSON: %s", e)
            return []

        if isinstance(payload, dict):
            payload = payload.get("models", [])
        if not isinstance(payload, list):
            logger.warning("OPENAGENTS_MODELS_JSON must be a JSON array (or object with key 'models').")
            return []

        models: list[ModelConfig] = []
        for index, item in enumerate(payload):
            if not isinstance(item, dict):
                logger.warning("Skip OPENAGENTS_MODELS_JSON[%s]: expected object, got %s", index, type(item).__name__)
                continue
            try:
                models.append(ModelConfig(**cls.resolve_env_variables(item)))
            except Exception as e:
                logger.warning("Skip invalid model entry in OPENAGENTS_MODELS_JSON[%s]: %s", index, e)
        return models

    @classmethod
    def from_runtime_defaults(cls) -> Self:
        """Create runtime config without config.yaml.

        No implicit fallback is applied. Model config must be injected per run
        (e.g., via `configurable.model_config`) or provided explicitly through
        OPENAGENTS_MODELS_JSON.
        """
        models = cls._load_models_from_models_json_env()
        if not models:
            logger.info("No config.yaml found and OPENAGENTS_MODELS_JSON is empty. Runtime expects per-request model injection.")

        sandbox_use = os.getenv("OPENAGENTS_SANDBOX_PROVIDER", "src.sandbox.local:LocalSandboxProvider")
        return cls(
            models=models,
            sandbox=SandboxConfig(use=sandbox_use),
            tools=[],
            tool_groups=[],
            skills=SkillsConfig(),
            extensions=ExtensionsConfig.from_file(),
        )

    @classmethod
    def from_file(cls, config_path: str | None = None) -> Self:
        """Load config from YAML file.

        See `resolve_config_path` for more details.

        Args:
            config_path: Path to the config file.

        Returns:
            AppConfig: The loaded config.
        """
        resolved_path = cls.resolve_config_path(config_path)
        if resolved_path is None:
            logger.info("config.yaml not found. Use runtime fallback config mode.")
            return cls.from_runtime_defaults()

        with open(resolved_path, encoding="utf-8") as f:
            config_data = yaml.safe_load(f) or {}
        config_data = cls.resolve_env_variables(config_data)
        if not isinstance(config_data, dict):
            raise ValueError(f"Config file {resolved_path} must contain a YAML object at top-level.")

        config_data.setdefault("models", [])
        config_data.setdefault("tools", [])
        config_data.setdefault("tool_groups", [])
        config_data.setdefault("skills", {})
        config_data.setdefault("sandbox", {"use": os.getenv("OPENAGENTS_SANDBOX_PROVIDER", "src.sandbox.local:LocalSandboxProvider")})

        # Load title config if present
        if "title" in config_data:
            load_title_config_from_dict(config_data["title"])

        # Load summarization config if present
        if "summarization" in config_data:
            load_summarization_config_from_dict(config_data["summarization"])

        # Load memory config if present
        if "memory" in config_data:
            load_memory_config_from_dict(config_data["memory"])

        # Load subagents config if present
        if "subagents" in config_data:
            load_subagents_config_from_dict(config_data["subagents"])

        # Load extensions config separately (it's in a different file)
        extensions_config = ExtensionsConfig.from_file()
        config_data["extensions"] = extensions_config.model_dump()

        result = cls.model_validate(config_data)
        return result

    @classmethod
    def resolve_env_variables(cls, config: Any) -> Any:
        """Recursively resolve environment variables in the config.

        Environment variables are resolved using the `os.getenv` function. Example: $OPENAI_API_KEY

        Args:
            config: The config to resolve environment variables in.

        Returns:
            The config with environment variables resolved.
        """
        if isinstance(config, str):
            if config.startswith("$"):
                env_value = os.getenv(config[1:])
                if env_value is None:
                    raise ValueError(f"Environment variable {config[1:]} not found for config value {config}")
                return env_value
            return config
        elif isinstance(config, dict):
            return {k: cls.resolve_env_variables(v) for k, v in config.items()}
        elif isinstance(config, list):
            return [cls.resolve_env_variables(item) for item in config]
        return config

    def get_model_config(self, name: str) -> ModelConfig | None:
        """Get the model config by name.

        Args:
            name: The name of the model to get the config for.

        Returns:
            The model config if found, otherwise None.
        """
        return next((model for model in self.models if model.name == name), None)

    def get_tool_config(self, name: str) -> ToolConfig | None:
        """Get the tool config by name.

        Args:
            name: The name of the tool to get the config for.

        Returns:
            The tool config if found, otherwise None.
        """
        return next((tool for tool in self.tools if tool.name == name), None)

    def get_tool_group_config(self, name: str) -> ToolGroupConfig | None:
        """Get the tool group config by name.

        Args:
            name: The name of the tool group to get the config for.

        Returns:
            The tool group config if found, otherwise None.
        """
        return next((group for group in self.tool_groups if group.name == name), None)


_app_config: AppConfig | None = None


def get_app_config() -> AppConfig:
    """Get the OpenAgents config instance.

    Returns a cached singleton instance. Use `reload_app_config()` to reload
    from file, or `reset_app_config()` to clear the cache.
    """
    global _app_config
    if _app_config is None:
        _app_config = AppConfig.from_file()
    return _app_config


def reload_app_config(config_path: str | None = None) -> AppConfig:
    """Reload the config from file and update the cached instance.

    This is useful when the config file has been modified and you want
    to pick up the changes without restarting the application.

    Args:
        config_path: Optional path to config file. If not provided,
                     uses the default resolution strategy.

    Returns:
        The newly loaded AppConfig instance.
    """
    global _app_config
    _app_config = AppConfig.from_file(config_path)
    return _app_config


def reset_app_config() -> None:
    """Reset the cached config instance.

    This clears the singleton cache, causing the next call to
    `get_app_config()` to reload from file. Useful for testing
    or when switching between different configurations.
    """
    global _app_config
    _app_config = None


def set_app_config(config: AppConfig) -> None:
    """Set a custom config instance.

    This allows injecting a custom or mock config for testing purposes.

    Args:
        config: The AppConfig instance to use.
    """
    global _app_config
    _app_config = config
