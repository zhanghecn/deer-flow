"""Configuration for automatic thread title generation."""

from pydantic import BaseModel, Field


class TitleConfig(BaseModel):
    """Configuration for automatic thread title generation."""

    enabled: bool = Field(
        default=True,
        description="Whether to enable automatic title generation",
    )
    max_words: int = Field(
        default=6,
        ge=1,
        le=20,
        description="Maximum number of words in the generated title",
    )
    max_chars: int = Field(
        default=60,
        ge=10,
        le=200,
        description="Maximum number of characters in the generated title",
    )
    model_name: str | None = Field(
        default=None,
        description="Model name to use for title generation. If None, middleware falls back to user-message-based title.",
    )
    prompt_template: str = Field(
        default=(
            "You are a title generator. You output ONLY a thread title. Nothing else.\n\n"
            "<task>\n"
            "Generate a brief title that helps the user find this conversation later.\n"
            "The output must be a single line and no more than {max_chars} characters.\n"
            "</task>\n\n"
            "<rules>\n"
            "- Use the same language as the user's message.\n"
            "- Keep the title natural and grammatically correct.\n"
            "- Focus on the user's main goal, not on tools or process.\n"
            "- Never include tool names (for example: read_file, execute, edit_file).\n"
            "- Keep exact technical terms, filenames, and key numbers.\n"
            "- Do not include explanations, prefixes, or quotes.\n"
            "</rules>\n\n"
            "User: {user_msg}\n"
            "Assistant: {assistant_msg}\n\n"
            "Title:"
        ),
        description="Prompt template for title generation",
    )


# Global configuration instance
_title_config: TitleConfig = TitleConfig()


def get_title_config() -> TitleConfig:
    """Get the current title configuration."""
    return _title_config


def set_title_config(config: TitleConfig) -> None:
    """Set the title configuration."""
    global _title_config
    _title_config = config


def load_title_config_from_dict(config_dict: dict) -> None:
    """Load title configuration from a dictionary."""
    global _title_config
    _title_config = TitleConfig(**config_dict)
