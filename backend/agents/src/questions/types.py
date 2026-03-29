from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_CATCH_ALL_OPTION_PREFIXES = ("other", "其他", "其它")
_QUESTION_OPTION_LABEL_MAX_LENGTH = 24
_QUESTION_HEADER_MAX_LENGTH = 30
_QUESTION_TEXT_MAX_LENGTH = 240
_QUESTION_BULLET_RE = re.compile(r"(?m)^\s*(?:#{1,6}|\d+[.)]|[-*•])\s+")
_QUESTION_FENCE_RE = re.compile(r"```|<[/a-zA-Z][^>]*>")
_CHOICE_WITHOUT_OPTIONS_RE = re.compile(
    r"(?:哪个|哪些|选择|选项|方案|方向|优先|采用|何种|哪种|which|choose|select|option|approach|format|scope)",
    re.IGNORECASE,
)


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


class QuestionOption(BaseModel):
    label: str = Field(
        description="Display text for this option. Keep it concise.",
    )
    description: str | None = Field(
        default=None,
        description="Optional short explanation of the option.",
    )

    @field_validator("label")
    @classmethod
    def _validate_label(cls, value: str) -> str:
        normalized = _normalize_text(value)
        if normalized is None:
            raise ValueError("Question option labels must be non-empty.")
        if normalized.lower().startswith(_CATCH_ALL_OPTION_PREFIXES):
            raise ValueError(
                'Do not use catch-all options such as "Other"; the UI already provides typed custom input.',
            )
        if len(normalized) > _QUESTION_OPTION_LABEL_MAX_LENGTH:
            raise ValueError(
                "Question option labels must stay concise. Move supporting detail into `description`.",
            )
        return normalized

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: str | None) -> str | None:
        return _normalize_text(value)


class QuestionInput(BaseModel):
    header: str | None = Field(
        default=None,
        description="Very short label shown for this question.",
    )
    question: str = Field(
        description="Complete question shown to the user.",
    )
    options: list[QuestionOption] = Field(
        default_factory=list,
        description="Available choices for the user.",
    )
    multiple: bool = Field(
        default=False,
        description="Whether the user may select more than one answer.",
    )

    @field_validator("header")
    @classmethod
    def _validate_header(cls, value: str | None) -> str | None:
        normalized = _normalize_text(value)
        if normalized is not None and len(normalized) > _QUESTION_HEADER_MAX_LENGTH:
            raise ValueError(
                "Question headers must stay short. Move supporting detail into `question` or option descriptions.",
            )
        return normalized

    @field_validator("question")
    @classmethod
    def _validate_question(cls, value: str) -> str:
        normalized = _normalize_text(value)
        if normalized is None:
            raise ValueError("Question text must be non-empty.")
        if len(normalized) > _QUESTION_TEXT_MAX_LENGTH:
            raise ValueError(
                "Question text must stay concise. Move detailed analysis into option descriptions or the final response.",
            )
        if normalized.count("\n") > 2:
            raise ValueError(
                "Question text must stay short and focused. Split separate blockers into multiple `questions[]` entries.",
            )
        if _QUESTION_BULLET_RE.search(normalized) or _QUESTION_FENCE_RE.search(normalized):
            raise ValueError(
                "Question text must not contain markdown sections, bullet lists, or fenced blocks. Keep it as a focused prompt.",
            )
        return normalized

    @field_validator("options")
    @classmethod
    def _validate_option_count(cls, value: list[QuestionOption]) -> list[QuestionOption]:
        if len(value) > 4:
            raise ValueError(
                "Question options must stay focused. Use at most 4 concrete choices and rely on custom input for edge cases.",
            )
        return value

    @model_validator(mode="after")
    def _validate_choice_questions_have_options(self) -> "QuestionInput":
        if len(self.options) == 0 and _CHOICE_WITHOUT_OPTIONS_RE.search(self.question):
            raise ValueError(
                "Choice-oriented questions must include concrete `options` instead of embedding the choices in the question body.",
            )
        return self


class QuestionInfo(QuestionInput):
    custom: bool = Field(
        default=True,
        description="Whether the UI should offer typed custom input.",
    )


class QuestionRequest(BaseModel):
    kind: Literal["question"] = "question"
    request_id: str = Field(description="Stable identifier for this question request.")
    questions: list[QuestionInfo] = Field(description="Questions to ask the user.")
    origin_agent_name: str | None = Field(
        default=None,
        description="Agent that originated the question request.",
    )

    @field_validator("request_id")
    @classmethod
    def _validate_request_id(cls, value: str) -> str:
        normalized = _normalize_text(value)
        if normalized is None:
            raise ValueError("Question requests require a request_id.")
        return normalized

    @field_validator("origin_agent_name")
    @classmethod
    def _validate_origin_agent_name(cls, value: str | None) -> str | None:
        return _normalize_text(value)


class QuestionReply(BaseModel):
    request_id: str = Field(description="The request being answered.")
    answers: list[list[str]] = Field(
        default_factory=list,
        description="Answers in question order. Each answer is a list of labels.",
    )
    rejected: bool = Field(
        default=False,
        description="Whether the user dismissed the question instead of answering.",
    )

    @field_validator("request_id")
    @classmethod
    def _validate_reply_request_id(cls, value: str) -> str:
        normalized = _normalize_text(value)
        if normalized is None:
            raise ValueError("Question replies require a request_id.")
        return normalized

    @field_validator("answers")
    @classmethod
    def _validate_answers(cls, value: list[list[str]]) -> list[list[str]]:
        normalized_answers: list[list[str]] = []
        for answer in value:
            normalized_answer: list[str] = []
            for item in answer:
                normalized = _normalize_text(item)
                if normalized is not None:
                    normalized_answer.append(normalized)
            normalized_answers.append(normalized_answer)
        return normalized_answers


class QuestionToolResult(BaseModel):
    kind: Literal["question_result"] = "question_result"
    request_id: str
    status: Literal["answered", "rejected"]
    answers: list[list[str]] = Field(default_factory=list)
    message: str
