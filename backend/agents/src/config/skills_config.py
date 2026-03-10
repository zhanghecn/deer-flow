from pathlib import Path

from pydantic import BaseModel, Field

from src.config.config_files import resolve_relative_to_config_dir


class SkillsConfig(BaseModel):
    """Configuration for skills system"""

    path: str | None = Field(
        default=None,
        description="Path to the shared skills archive directory.",
    )
    container_path: str = Field(
        default="/mnt/skills",
        description="Path where skills are mounted in the sandbox container",
    )

    def get_skills_path(self, config_dir: Path) -> Path:
        """
        Get the resolved skills directory path.

        Returns:
            Path to the skills directory
        """
        if not self.path or not self.path.strip():
            raise RuntimeError("skills.path must be configured in config.yaml.")
        return resolve_relative_to_config_dir(self.path, config_dir=config_dir)

    def get_skill_container_path(self, skill_name: str, category: str = "public") -> str:
        """
        Get the full container path for a specific skill.

        Args:
            skill_name: Name of the skill (directory name)
            category: Category of the skill (public or custom)

        Returns:
            Full path to the skill in the container
        """
        return f"{self.container_path}/{category}/{skill_name}"
