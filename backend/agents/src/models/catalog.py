from __future__ import annotations

from src.config.model_config import ModelConfig
from src.config.runtime_db import get_runtime_db_store


def list_enabled_models() -> list[ModelConfig]:
    """Return enabled models from the database-only runtime catalog."""
    db_store = get_runtime_db_store()
    models: list[ModelConfig] = []
    for name in db_store.list_enabled_model_names():
        model = db_store.get_model(name)
        if model is not None:
            models.append(model)
    return models


def require_enabled_model(name: str) -> ModelConfig:
    """Resolve an enabled model strictly from the database."""
    normalized_name = str(name).strip()
    if not normalized_name:
        raise ValueError("Model name is required.") from None

    model = get_runtime_db_store().get_model(normalized_name)
    if model is None:
        raise ValueError(f"Model {normalized_name} not found in database or is disabled") from None
    return model
