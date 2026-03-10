from pathlib import Path

from pydantic import BaseModel, Field

from src.config.config_files import resolve_relative_to_config_dir


class StorageConfig(BaseModel):
    """Filesystem locations for archived agents and runtime thread data."""

    base_dir: str = Field(
        description="Root directory for archived agents, users, and threads.",
    )

    def resolve_base_dir(self, config_dir: Path) -> Path:
        return resolve_relative_to_config_dir(self.base_dir, config_dir=config_dir)
