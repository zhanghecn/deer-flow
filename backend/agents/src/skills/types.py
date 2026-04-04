from dataclasses import dataclass
from pathlib import Path


@dataclass
class Skill:
    """Represents a skill with its metadata and file path"""

    name: str
    description: str
    license: str | None
    skill_dir: Path
    skill_file: Path
    relative_path: Path  # Relative path from the scope root to the skill directory
    category: str  # e.g. 'store/dev' or 'store/prod'
    enabled: bool = False  # Whether this skill is enabled

    @property
    def skill_path(self) -> str:
        """Returns the relative path from the scope root to this skill's directory."""
        path = self.relative_path.as_posix()
        return "" if path == "." else path

    @property
    def source_path(self) -> str:
        """Return the canonical source_path for this skill."""

        relative_path = self.skill_path or self.skill_dir.name
        if self.category in {"system", "custom"}:
            return Path(self.category, "skills", relative_path).as_posix()
        return Path(self.category, relative_path).as_posix()

    def get_container_path(self, container_base_path: str = "/mnt/skills") -> str:
        """
        Get the full path to this skill in the container.

        Args:
            container_base_path: Base path where skills are mounted in the container

        Returns:
            Full container path to the skill directory
        """
        return f"{container_base_path}/{self.source_path}"

    def get_container_file_path(self, container_base_path: str = "/mnt/skills") -> str:
        """
        Get the full path to this skill's main file (SKILL.md) in the container.

        Args:
            container_base_path: Base path where skills are mounted in the container

        Returns:
            Full container path to the skill's SKILL.md file
        """
        return f"{self.get_container_path(container_base_path)}/SKILL.md"

    def __repr__(self) -> str:
        return f"Skill(name={self.name!r}, description={self.description!r}, category={self.category!r})"
