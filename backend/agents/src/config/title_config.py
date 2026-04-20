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
        description="Reserved for backward compatibility. Title generation is now local and message-based.",
    )
    prompt_template: str = Field(
        default=(
            "You are a title generator. You output ONLY a thread title. Nothing else.\n\n"
            "<task>\n"
            "Generate a brief title that would help the user find this conversation later.\n\n"
            "Follow all rules in <rules>\n"
            "Use the <examples> so you know what a good title looks like.\n"
            "Your output must be:\n"
            "- A single line\n"
            "- <= {max_chars} characters\n"
            "- No explanations\n"
            "</task>\n\n"
            "<rules>\n"
            "- you MUST use the same language as the user message you are summarizing\n"
            "- Title must be grammatically correct and read naturally - no word salad\n"
            "- Never include tool names in the title (e.g. \"read_file\", \"execute\", \"edit_file\")\n"
            "- Focus on the main topic or question the user needs to retrieve\n"
            "- Vary your phrasing - avoid repetitive patterns like always starting with \"Analyzing\"\n"
            "- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it\n"
            "- Keep exact: technical terms, numbers, filenames, HTTP codes\n"
            "- Remove: the, this, my, a, an\n"
            "- Never assume tech stack\n"
            "- Never use tools\n"
            "- NEVER respond to questions, just generate a title for the conversation\n"
            "- The title should NEVER include \"summarizing\" or \"generating\" when generating a title\n"
            "- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT\n"
            "- Always output something meaningful, even if the input is minimal.\n"
            "- If the user message is short or conversational (e.g. \"hello\", \"lol\", \"what's up\", \"hey\"):\n"
            "  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)\n"
            "</rules>\n\n"
            "<examples>\n"
            "\"debug 500 errors in production\" -> Debugging production 500 errors\n"
            "\"refactor user service\" -> Refactoring user service\n"
            "\"why is app.js failing\" -> app.js failure investigation\n"
            "\"implement rate limiting\" -> Rate limiting implementation\n"
            "\"how do I connect postgres to my API\" -> Postgres API connection\n"
            "\"best practices for React hooks\" -> React hooks best practices\n"
            "\"@src/auth.ts can you add refresh token support\" -> Auth refresh token support\n"
            "\"@utils/parser.ts this is broken\" -> Parser bug fix\n"
            "\"look at @config.json\" -> Config review\n"
            "\"@App.tsx add dark mode toggle\" -> Dark mode toggle in App\n"
            "</examples>\n\n"
            "<user_message>\n{user_msg}\n</user_message>\n"
            "<assistant_message>\n{assistant_msg}\n</assistant_message>\n\n"
            "Title:"
        ),
        description="Legacy prompt template retained for backward compatibility.",
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
