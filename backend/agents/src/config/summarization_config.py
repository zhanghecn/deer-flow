"""Configuration for conversation summarization."""

from typing import Literal

from pydantic import BaseModel, Field

ContextSizeType = Literal["fraction", "tokens", "messages"]

CLAUDE_CODE_COMPACTION_PROMPT = """CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation history below.
- Tool calls will be rejected and will waste your only turn.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, exact values, constraints, code patterns, and architectural decisions that would be essential for continuing work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - identifiers
     - URLs
     - commands
     - ports
     - secret codes or test markers
     - exact user-provided values
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.
3. If an earlier summary exists in the conversation, merge it with newer messages instead of replacing durable facts with only recent messages.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail.
2. Key Technical Concepts: List all important technical concepts, technologies, frameworks, and product contracts discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include important snippets or exact names where they are needed to continue.
4. Errors and fixes: List all errors that occurred, how they were fixed, and any user feedback about those errors.
5. Problem Solving: Document problems solved and any ongoing troubleshooting.
6. All user messages: List ALL user messages that are not tool results. These are critical for preserving user feedback, changed intent, secret codes, and exact constraints.
7. Pending Tasks: Outline pending tasks that the user explicitly asked you to work on.
8. Current Work: Describe precisely what was being worked on immediately before this summary request, including file names, code snippets, commands, and verification state where applicable.
9. Optional Next Step: List the next step directly related to the most recent work. If there is a next step, include direct quotes from the most recent conversation showing exactly what task was active and where it left off.

Conversation history:
{messages}

Please provide your summary following this structure and ensuring precision and thoroughness.

REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task."""


class ContextSize(BaseModel):
    """Context size specification for trigger or keep parameters."""

    type: ContextSizeType = Field(description="Type of context size specification")
    value: int | float = Field(description="Value for the context size specification")

    def to_tuple(self) -> tuple[ContextSizeType, int | float]:
        """Convert to tuple format expected by SummarizationMiddleware."""
        return (self.type, self.value)


class SummarizationConfig(BaseModel):
    """Configuration for automatic conversation summarization."""

    enabled: bool = Field(
        default=False,
        description="Whether to enable automatic conversation summarization",
    )
    model_name: str | None = Field(
        default=None,
        description="Model name to use for summarization (None = use a lightweight model)",
    )
    trigger: ContextSize | list[ContextSize] | None = Field(
        default=None,
        description="One or more thresholds that trigger summarization. When any threshold is met, summarization runs. "
        "Examples: {'type': 'messages', 'value': 50} triggers at 50 messages, "
        "{'type': 'tokens', 'value': 4000} triggers at 4000 tokens, "
        "{'type': 'fraction', 'value': 0.8} triggers at 80% of model's max input tokens",
    )
    keep: ContextSize = Field(
        default_factory=lambda: ContextSize(type="messages", value=20),
        description="Context retention policy after summarization. Specifies how much history to preserve. "
        "Examples: {'type': 'messages', 'value': 20} keeps 20 messages, "
        "{'type': 'tokens', 'value': 3000} keeps 3000 tokens, "
        "{'type': 'fraction', 'value': 0.3} keeps 30% of model's max input tokens",
    )
    trim_tokens_to_summarize: int | None = Field(
        default=None,
        description=(
            "Maximum tokens to keep when preparing messages for summarization. "
            "The default is null so compaction summarizes the full evicted transcript "
            "instead of dropping older durable facts from long-running tasks."
        ),
    )
    summary_prompt: str | None = Field(
        default=CLAUDE_CODE_COMPACTION_PROMPT,
        description="Custom prompt template for generating summaries. The template must include {messages}.",
    )


# Global configuration instance
_summarization_config: SummarizationConfig = SummarizationConfig()


def get_summarization_config() -> SummarizationConfig:
    """Get the current summarization configuration."""
    return _summarization_config


def set_summarization_config(config: SummarizationConfig) -> None:
    """Set the summarization configuration."""
    global _summarization_config
    _summarization_config = config


def load_summarization_config_from_dict(config_dict: dict) -> None:
    """Load summarization configuration from a dictionary."""
    global _summarization_config
    normalized = dict(config_dict)
    if normalized.get("summary_prompt") is None:
        # A YAML null means "use the repo default". Keeping the key as None
        # would bypass the Claude Code-style prompt and silently fall back to
        # LangChain's generic compact prompt in the Deep Agents middleware.
        normalized.pop("summary_prompt", None)
    _summarization_config = SummarizationConfig(**normalized)
