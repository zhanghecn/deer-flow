"""Skills middleware for loading and exposing agent skills to the system prompt.

This module implements Anthropic's agent skills pattern with progressive disclosure,
loading skills from backend storage via configurable sources.

## Architecture

Skills are loaded from one or more **sources** - paths in a backend where skills are
organized. Sources are loaded in order, with later sources overriding earlier ones
when skills have the same name (last one wins). This enables layering: base -> user
-> project -> team skills.

The middleware uses backend APIs exclusively (no direct filesystem access), making it
portable across different storage backends (filesystem, state, remote storage, etc.).

For StateBackend (ephemeral/in-memory), use a factory function:
```python
SkillsMiddleware(backend=lambda rt: StateBackend(rt), ...)
```

## Skill Structure

Each skill is a directory containing a SKILL.md file with YAML frontmatter:

```
/skills/user/web-research/
├── SKILL.md          # Required: YAML frontmatter + markdown instructions
└── helper.py         # Optional: supporting files
```

SKILL.md format:
```markdown
---
name: web-research
description: Structured approach to conducting thorough web research
license: MIT
---

# Web Research Skill

## When to Use
- User asks you to research a topic
...
```

## Skill Metadata (SkillMetadata)

Parsed from YAML frontmatter per Agent Skills specification:
- `name`: Skill identifier (max 64 chars, lowercase alphanumeric and hyphens)
- `description`: What the skill does (max 1024 chars)
- `path`: Backend path to the SKILL.md file
- Optional: `license`, `compatibility`, `metadata`, `allowed_tools`

## Sources

Sources are simply paths to skill directories in the backend. The source name is
derived from the last component of the path (e.g., "/skills/user/" -> "user").

Example sources:
```python
[
    "/skills/user/",
    "/skills/project/"
]
```

## Path Conventions

All paths use POSIX conventions (forward slashes) via `PurePosixPath`:
- Backend paths: "/skills/user/web-research/SKILL.md"
- Virtual, platform-independent
- Backends handle platform-specific conversions as needed

## Usage

```python
from deepagents.backends.state import StateBackend
from deepagents.middleware.skills import SkillsMiddleware

middleware = SkillsMiddleware(
    backend=my_backend,
    sources=[
        "/skills/base/",
        "/skills/user/",
        "/skills/project/",
    ],
)
```
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Annotated

import yaml
from langchain.agents.middleware.types import PrivateStateAttr

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from langchain_core.runnables import RunnableConfig
    from langgraph.runtime import Runtime

    from deepagents.backends.protocol import BACKEND_TYPES, BackendProtocol

from typing import NotRequired, TypedDict

from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ContextT,
    ModelRequest,
    ModelResponse,
    ResponseT,
)
from langgraph.prebuilt import ToolRuntime

from deepagents.middleware._utils import append_to_system_message

logger = logging.getLogger(__name__)

# Security: Maximum size for SKILL.md files to prevent DoS attacks (10MB)
MAX_SKILL_FILE_SIZE = 10 * 1024 * 1024

# Agent Skills specification constraints (https://agentskills.io/specification)
MAX_SKILL_NAME_LENGTH = 64
MAX_SKILL_DESCRIPTION_LENGTH = 1024
MAX_SKILL_COMPATIBILITY_LENGTH = 500
SUPPORTED_SKILL_I18N_LOCALES = ("en-US", "zh-CN")
SKILL_I18N_FILE_NAME = "skill.i18n.json"


class SkillMetadata(TypedDict):
    """Metadata for a skill per Agent Skills specification (https://agentskills.io/specification)."""

    path: str
    """Path to the SKILL.md file."""

    name: str
    """Skill identifier.

    Constraints per Agent Skills specification:

    - 1-64 characters
    - Unicode lowercase alphanumeric and hyphens only (`a-z` and `-`).
    - Must not start or end with `-`
    - Must not contain consecutive `--`
    - Must match the parent directory name containing the `SKILL.md` file
    """

    description: str
    """What the skill does.

    Constraints per Agent Skills specification:

    - 1-1024 characters
    - Should describe both what the skill does and when to use it
    - Should include specific keywords that help agents identify relevant tasks
    """

    license: str | None
    """License name or reference to bundled license file."""

    compatibility: str | None
    """Environment requirements.

    Constraints per Agent Skills specification:

    - 1-500 characters if provided
    - Should only be included if there are specific compatibility requirements
    - Can indicate intended product, required packages, etc.
    """

    metadata: dict[str, str]
    """Arbitrary key-value mapping for additional metadata.

    Clients can use this to store additional properties not defined by the spec.

    It is recommended to keep key names unique to avoid conflicts.
    """

    allowed_tools: list[str]
    """Tool names the skill recommends using.

    Warning: this is experimental.

    Constraints per Agent Skills specification:

    - Space-delimited list of tool names
    """


class SkillsState(AgentState):
    """State for the skills middleware."""

    skills_metadata: NotRequired[Annotated[list[SkillMetadata], PrivateStateAttr]]
    """List of loaded skill metadata from configured sources. Not propagated to parent agents."""


class SkillsStateUpdate(TypedDict):
    """State update for the skills middleware."""

    skills_metadata: list[SkillMetadata]
    """List of loaded skill metadata to merge into state."""


def _validate_skill_name(name: str, directory_name: str) -> tuple[bool, str]:
    """Validate skill name per Agent Skills specification.

    Constraints per Agent Skills specification:

    - 1-64 characters
    - Unicode lowercase alphanumeric and hyphens only (`a-z` and `-`).
    - Must not start or end with `-`
    - Must not contain consecutive `--`
    - Must match the parent directory name containing the `SKILL.md` file

    Unicode lowercase alphanumeric means any character where `c.isalpha() and
    c.islower()` or `c.isdigit()` returns `True`, which covers accented Latin
    characters (e.g., `'café'`, `'über-tool'`) and other scripts.

    Args:
        name: Skill name from YAML frontmatter
        directory_name: Parent directory name

    Returns:
        `(is_valid, error_message)` tuple.

            Error message is empty if valid.
    """
    if not name:
        return False, "name is required"
    if len(name) > MAX_SKILL_NAME_LENGTH:
        return False, "name exceeds 64 characters"
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False, "name must be lowercase alphanumeric with single hyphens only"
    for c in name:
        if c == "-":
            continue
        if (c.isalpha() and c.islower()) or c.isdigit():
            continue
        return False, "name must be lowercase alphanumeric with single hyphens only"
    if name != directory_name:
        return False, f"name '{name}' must match directory name '{directory_name}'"
    return True, ""


def _parse_skill_metadata(  # noqa: C901
    content: str,
    skill_path: str,
    directory_name: str,
    i18n_content: str | None = None,
    preferred_locale: str | None = None,
) -> SkillMetadata | None:
    """Parse YAML frontmatter from `SKILL.md` content.

    Extracts metadata per Agent Skills specification from YAML frontmatter
    delimited by `---` markers at the start of the content.

    Args:
        content: Content of the `SKILL.md` file
        skill_path: Path to the `SKILL.md` file (for error messages and metadata)
        directory_name: Name of the parent directory containing the skill

    Returns:
        `SkillMetadata` if parsing succeeds, `None` if parsing fails or
            validation errors occur
    """
    if len(content) > MAX_SKILL_FILE_SIZE:
        logger.warning("Skipping %s: content too large (%d bytes)", skill_path, len(content))
        return None

    # Match YAML frontmatter between --- delimiters
    frontmatter_pattern = r"^---\s*\n(.*?)\n---\s*\n"
    match = re.match(frontmatter_pattern, content, re.DOTALL)

    if not match:
        logger.warning("Skipping %s: no valid YAML frontmatter found", skill_path)
        return None

    frontmatter_str = match.group(1)

    # Parse YAML using safe_load for proper nested structure support
    try:
        frontmatter_data = yaml.safe_load(frontmatter_str)
    except yaml.YAMLError as e:
        logger.warning("Invalid YAML in %s: %s", skill_path, e)
        return None

    if not isinstance(frontmatter_data, dict):
        logger.warning("Skipping %s: frontmatter is not a mapping", skill_path)
        return None

    name = str(frontmatter_data.get("name", "")).strip()
    description = str(frontmatter_data.get("description", "")).strip()
    if not name or not description:
        logger.warning("Skipping %s: missing required 'name' or 'description'", skill_path)
        return None

    # Validate name format per spec (warn but continue loading for backwards compatibility)
    is_valid, error = _validate_skill_name(str(name), directory_name)
    if not is_valid:
        logger.warning(
            "Skill '%s' in %s does not follow Agent Skills specification: %s. Consider renaming for spec compliance.",
            name,
            skill_path,
            error,
        )

    description_str = _select_skill_description(
        fallback_description=description,
        i18n_content=i18n_content,
        preferred_locale=preferred_locale,
        skill_path=skill_path,
    )
    if len(description_str) > MAX_SKILL_DESCRIPTION_LENGTH:
        logger.warning(
            "Description exceeds %d characters in %s, truncating",
            MAX_SKILL_DESCRIPTION_LENGTH,
            skill_path,
        )
        description_str = description_str[:MAX_SKILL_DESCRIPTION_LENGTH]

    raw_tools = frontmatter_data.get("allowed-tools")
    if isinstance(raw_tools, str):
        allowed_tools = [
            t.strip(",")  # Support commas for compatibility with skills created for Claude Code.
            for t in raw_tools.split()
            if t.strip(",")
        ]
    else:
        if raw_tools is not None:
            logger.warning(
                "Ignoring non-string 'allowed-tools' in %s (got %s)",
                skill_path,
                type(raw_tools).__name__,
            )
        allowed_tools = []

    compatibility_str = str(frontmatter_data.get("compatibility", "")).strip() or None
    if compatibility_str and len(compatibility_str) > MAX_SKILL_COMPATIBILITY_LENGTH:
        logger.warning(
            "Compatibility exceeds %d characters in %s, truncating",
            MAX_SKILL_COMPATIBILITY_LENGTH,
            skill_path,
        )
        compatibility_str = compatibility_str[:MAX_SKILL_COMPATIBILITY_LENGTH]

    return SkillMetadata(
        name=str(name),
        description=description_str,
        path=skill_path,
        metadata=_validate_metadata(frontmatter_data.get("metadata", {}), skill_path),
        license=str(frontmatter_data.get("license", "")).strip() or None,
        compatibility=compatibility_str,
        allowed_tools=allowed_tools,
    )


def _normalize_skill_i18n_description_map(
    raw: object,
    *,
    skill_path: str,
) -> dict[str, str]:
    if not isinstance(raw, dict):
        if raw:
            logger.warning(
                "Ignoring non-dict skill description i18n in %s (got %s)",
                skill_path,
                type(raw).__name__,
            )
        return {}

    normalized: dict[str, str] = {}
    for locale in SUPPORTED_SKILL_I18N_LOCALES:
        text = raw.get(locale)
        if not isinstance(text, str):
            continue
        normalized_text = text.strip()
        if not normalized_text:
            continue
        normalized[locale] = normalized_text
    return normalized


def _load_skill_i18n_description_map(
    *,
    i18n_content: str | None,
    skill_path: str,
) -> dict[str, str]:
    if not i18n_content:
        return {}

    try:
        payload = json.loads(i18n_content)
    except json.JSONDecodeError as exc:
        logger.warning("Invalid skill i18n JSON in %s: %s", skill_path, exc)
        return {}

    if not isinstance(payload, dict):
        logger.warning("Ignoring non-object skill i18n payload in %s", skill_path)
        return {}

    return _normalize_skill_i18n_description_map(
        payload.get("description"),
        skill_path=skill_path,
    )


def _normalize_preferred_skill_locale(value: object) -> str | None:
    text = str(value or "").strip()
    if text in SUPPORTED_SKILL_I18N_LOCALES:
        return text
    return None


def _preferred_skill_locale(state: object, config: RunnableConfig | None) -> str | None:
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
    if isinstance(configurable, dict):
        preferred_locale = _normalize_preferred_skill_locale(configurable.get("locale"))
        if preferred_locale is not None:
            return preferred_locale

    if not isinstance(state, dict):
        return None

    messages = state.get("messages")
    if not isinstance(messages, list):
        return None

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        if message.get("type") not in {"human", "user"}:
            continue
        content = str(message.get("content") or "")
        if re.search(r"[\u4e00-\u9fff]", content):
            return "zh-CN"
        if content.strip():
            return "en-US"
    return None


def _select_skill_description(
    *,
    fallback_description: str,
    i18n_content: str | None,
    preferred_locale: str | None,
    skill_path: str,
) -> str:
    description_i18n = _load_skill_i18n_description_map(
        i18n_content=i18n_content,
        skill_path=skill_path,
    )
    if not description_i18n:
        return fallback_description

    if preferred_locale:
        localized = description_i18n.get(preferred_locale, "").strip()
        if localized:
            return localized

    return fallback_description


def _validate_metadata(
    raw: object,
    skill_path: str,
) -> dict[str, str]:
    """Validate and normalize the metadata field from YAML frontmatter.

    YAML `safe_load` can return any type for the `metadata` key. This
    ensures the values in `SkillMetadata` are always a `dict[str, str]` by
    coercing via `str()` and rejecting non-dict inputs.

    Args:
        raw: Raw value from `frontmatter_data.get("metadata", {})`.
        skill_path: Path to the `SKILL.md` file (for warning messages).

    Returns:
        A validated `dict[str, str]`.
    """
    if not isinstance(raw, dict):
        if raw:
            logger.warning(
                "Ignoring non-dict metadata in %s (got %s)",
                skill_path,
                type(raw).__name__,
            )
        return {}
    return {str(k): str(v) for k, v in raw.items()}


def _format_skill_annotations(skill: SkillMetadata) -> str:
    """Build a parenthetical annotation string from optional skill fields.

    Combines license and compatibility into a comma-separated string for
    display in the system prompt skill listing.

    Args:
        skill: Skill metadata to extract annotations from.

    Returns:
        Annotation string like `'License: MIT, Compatibility: Python 3.10+'`,
            or empty string if neither field is set.
    """
    parts: list[str] = []
    if skill.get("license"):
        parts.append(f"License: {skill['license']}")
    if skill.get("compatibility"):
        parts.append(f"Compatibility: {skill['compatibility']}")
    return ", ".join(parts)


def _skill_source_hint(skill: SkillMetadata) -> str | None:
    """Return a stable non-filesystem source hint for prompt display.

    We expose archive source hints such as `store/prod/contracts/review`
    because they are model-usable identifiers for the `skill` tool. We do not
    surface raw runtime filesystem paths here.
    """

    raw_path = str(skill.get("path") or "").strip()
    if not raw_path.startswith("/mnt/skills/"):
        return None

    relative = raw_path[len("/mnt/skills/") :].strip("/")
    if relative.endswith("/SKILL.md"):
        relative = relative[: -len("/SKILL.md")]
    return relative or None


def _list_skills(
    backend: BackendProtocol,
    source_path: str,
    *,
    preferred_locale: str | None = None,
) -> list[SkillMetadata]:
    """List all skills from a backend source.

    Scans backend for subdirectories containing `SKILL.md` files, downloads
    their content, parses YAML frontmatter, and returns skill metadata.

    Expected structure:

    ```txt
    source_path/
    └── skill-name/
        ├── SKILL.md   # Required
        └── helper.py  # Optional
    ```

    Args:
        backend: Backend instance to use for file operations
        source_path: Path to the skills directory in the backend

    Returns:
        List of skill metadata from successfully parsed `SKILL.md` files
    """
    skills: list[SkillMetadata] = []
    items = backend.ls_info(source_path)

    # Find all skill directories (directories containing SKILL.md)
    skill_dirs = []
    for item in items:
        if not item.get("is_dir"):
            continue
        skill_dirs.append(item["path"])

    if not skill_dirs:
        return []

    # For each skill directory, check if SKILL.md exists and download it
    skill_file_pairs = []
    for skill_dir_path in skill_dirs:
        # Construct SKILL.md path using PurePosixPath for safe, standardized path operations
        skill_dir = PurePosixPath(skill_dir_path)
        skill_md_path = str(skill_dir / "SKILL.md")
        skill_i18n_path = str(skill_dir / SKILL_I18N_FILE_NAME)
        skill_file_pairs.append((skill_dir_path, skill_md_path, skill_i18n_path))

    paths_to_download: list[str] = []
    for _, skill_md_path, skill_i18n_path in skill_file_pairs:
        paths_to_download.extend([skill_md_path, skill_i18n_path])
    responses = backend.download_files(paths_to_download)

    # Parse each downloaded SKILL.md
    for index, (skill_dir_path, skill_md_path, skill_i18n_path) in enumerate(skill_file_pairs):
        skill_md_response = responses[index * 2]
        skill_i18n_response = responses[index * 2 + 1]
        if skill_md_response.error:
            # Skill doesn't have a SKILL.md, skip it
            continue

        if skill_md_response.content is None:
            logger.warning("Downloaded skill file %s has no content", skill_md_path)
            continue

        try:
            content = skill_md_response.content.decode("utf-8")
        except UnicodeDecodeError as e:
            logger.warning("Error decoding %s: %s", skill_md_path, e)
            continue

        i18n_content: str | None = None
        if skill_i18n_response.error is None and skill_i18n_response.content is not None:
            try:
                i18n_content = skill_i18n_response.content.decode("utf-8")
            except UnicodeDecodeError as e:
                logger.warning("Error decoding %s: %s", skill_i18n_path, e)
                i18n_content = None

        # Extract directory name from path using PurePosixPath
        directory_name = PurePosixPath(skill_dir_path).name

        # Parse metadata
        skill_metadata = _parse_skill_metadata(
            content=content,
            skill_path=skill_md_path,
            directory_name=directory_name,
            i18n_content=i18n_content,
            preferred_locale=preferred_locale,
        )
        if skill_metadata:
            skills.append(skill_metadata)

    return skills


async def _alist_skills(
    backend: BackendProtocol,
    source_path: str,
    *,
    preferred_locale: str | None = None,
) -> list[SkillMetadata]:
    """List all skills from a backend source (async version).

    Scans backend for subdirectories containing `SKILL.md` files, downloads
    their content, parses YAML frontmatter, and returns skill metadata.

    Expected structure:

    ```txt
    source_path/
    └── skill-name/
        ├── SKILL.md   # Required
        └── helper.py  # Optional
    ```

    Args:
        backend: Backend instance to use for file operations
        source_path: Path to the skills directory in the backend

    Returns:
        List of skill metadata from successfully parsed `SKILL.md` files
    """
    skills: list[SkillMetadata] = []
    items = await backend.als_info(source_path)

    # Find all skill directories (directories containing SKILL.md)
    skill_dirs = []
    for item in items:
        if not item.get("is_dir"):
            continue
        skill_dirs.append(item["path"])

    if not skill_dirs:
        return []

    # For each skill directory, check if SKILL.md exists and download it
    skill_file_pairs = []
    for skill_dir_path in skill_dirs:
        # Construct SKILL.md path using PurePosixPath for safe, standardized path operations
        skill_dir = PurePosixPath(skill_dir_path)
        skill_md_path = str(skill_dir / "SKILL.md")
        skill_i18n_path = str(skill_dir / SKILL_I18N_FILE_NAME)
        skill_file_pairs.append((skill_dir_path, skill_md_path, skill_i18n_path))

    paths_to_download: list[str] = []
    for _, skill_md_path, skill_i18n_path in skill_file_pairs:
        paths_to_download.extend([skill_md_path, skill_i18n_path])
    responses = await backend.adownload_files(paths_to_download)

    # Parse each downloaded SKILL.md
    for index, (skill_dir_path, skill_md_path, skill_i18n_path) in enumerate(skill_file_pairs):
        skill_md_response = responses[index * 2]
        skill_i18n_response = responses[index * 2 + 1]
        if skill_md_response.error:
            # Skill doesn't have a SKILL.md, skip it
            continue

        if skill_md_response.content is None:
            logger.warning("Downloaded skill file %s has no content", skill_md_path)
            continue

        try:
            content = skill_md_response.content.decode("utf-8")
        except UnicodeDecodeError as e:
            logger.warning("Error decoding %s: %s", skill_md_path, e)
            continue

        i18n_content: str | None = None
        if skill_i18n_response.error is None and skill_i18n_response.content is not None:
            try:
                i18n_content = skill_i18n_response.content.decode("utf-8")
            except UnicodeDecodeError as e:
                logger.warning("Error decoding %s: %s", skill_i18n_path, e)
                i18n_content = None

        # Extract directory name from path using PurePosixPath
        directory_name = PurePosixPath(skill_dir_path).name

        # Parse metadata
        skill_metadata = _parse_skill_metadata(
            content=content,
            skill_path=skill_md_path,
            directory_name=directory_name,
            i18n_content=i18n_content,
            preferred_locale=preferred_locale,
        )
        if skill_metadata:
            skills.append(skill_metadata)

    return skills


SKILLS_SYSTEM_PROMPT = """

## Skills System

You have access to a skills library that provides specialized capabilities and domain knowledge.

**Available Skills:**

{skills_list}

**How to Use Skills (Progressive Disclosure):**

Skills follow a **progressive disclosure** pattern - you see their name and description above, but only load full instructions when needed:

1. **Recognize when a skill applies**: Check if the user's task matches a skill's description
2. **Load the skill's full instructions**: Call the `skill` tool for the selected skill
3. **Follow the skill's instructions**: Tool output contains the full SKILL.md workflow plus a runtime base directory for helper files
4. **Access supporting files**: After loading a skill, resolve any `scripts/...`, `templates/...`, `references/...`, or other relative paths from the runtime base directory returned by the `skill` tool

**When to Use Skills:**
- User's request matches a skill's domain (e.g., "research X" -> web-research skill)
- You need specialized knowledge or structured workflows
- A skill provides proven patterns for complex tasks

**Example Workflow:**

User: "Can you research the latest developments in quantum computing?"

1. Check available skills -> See "web-research" skill in the list
2. Call `skill(name="web-research")`
3. Treat the returned runtime base directory as the skill base directory
4. Follow the skill's workflow and resolve any relative helper paths from that base directory

Remember: Skills make you more capable and consistent. When in doubt, check if a skill exists for the task!
"""


class SkillsMiddleware(AgentMiddleware[SkillsState, ContextT, ResponseT]):
    """Middleware for loading and exposing agent skills to the system prompt.

    Loads skills from backend sources and injects them into the system prompt
    using progressive disclosure (metadata first, full content on demand).

    Skills are loaded in source order with later sources overriding
    earlier ones.

    Example:
        ```python
        from deepagents.backends.filesystem import FilesystemBackend

        backend = FilesystemBackend(root_dir="/path/to/skills")
        middleware = SkillsMiddleware(
            backend=backend,
            sources=[
                "/path/to/skills/user/",
                "/path/to/skills/project/",
            ],
        )
        ```

    Args:
        backend: Backend instance for file operations
        sources: List of skill source paths.

            Source names are derived from the last path component.
    """

    state_schema = SkillsState

    def __init__(self, *, backend: BACKEND_TYPES, sources: list[str]) -> None:
        """Initialize the skills middleware.

        Args:
            backend: Backend instance or factory function that takes runtime and
                returns a backend.

                Use a factory for StateBackend: `lambda rt: StateBackend(rt)`
            sources: List of skill source paths (e.g.,
                `['/skills/user/', '/skills/project/']`).
        """
        self._backend = backend
        self.sources = sources
        self.system_prompt_template = SKILLS_SYSTEM_PROMPT

    def _get_backend(self, state: SkillsState, runtime: Runtime, config: RunnableConfig) -> BackendProtocol:
        """Resolve backend from instance or factory.

        Args:
            state: Current agent state.
            runtime: Runtime context for factory functions.
            config: Runnable config to pass to backend factory.

        Returns:
            Resolved backend instance
        """
        if callable(self._backend):
            # Construct an artificial tool runtime to resolve backend factory
            tool_runtime = ToolRuntime(
                state=state,
                context=runtime.context,
                stream_writer=runtime.stream_writer,
                store=runtime.store,
                config=config,
                tool_call_id=None,
            )
            backend = self._backend(tool_runtime)  # ty: ignore[call-top-callable, invalid-argument-type]
            if backend is None:
                msg = "SkillsMiddleware requires a valid backend instance"
                raise AssertionError(msg)
            return backend

        return self._backend

    def _format_skills_locations(self) -> str:
        """Format configured source roots for diagnostics and tests."""
        locations = []

        for i, source_path in enumerate(self.sources):
            name = PurePosixPath(source_path.rstrip("/")).name.capitalize()
            suffix = " (higher priority)" if i == len(self.sources) - 1 else ""
            locations.append(f"**{name} Skills**: `{source_path}`{suffix}")

        return "\n".join(locations)

    def _format_skills_list(self, skills: list[SkillMetadata]) -> str:
        """Format skills metadata for display in system prompt."""
        if not skills:
            return "(No skills available yet.)"

        lines = []
        for skill in skills:
            annotations = _format_skill_annotations(skill)
            source_hint = _skill_source_hint(skill)
            desc_line = f"- **{skill['name']}**: {skill['description']}"
            if source_hint:
                desc_line += f" [source: {source_hint}]"
            if annotations:
                desc_line += f" ({annotations})"
            lines.append(desc_line)
            if skill["allowed_tools"]:
                lines.append(f"  -> Allowed tools: {', '.join(skill['allowed_tools'])}")
            lines.append(f"  -> Load with `skill(name=\"{skill['name']}\")` when needed")

        return "\n".join(lines)

    def modify_request(self, request: ModelRequest[ContextT]) -> ModelRequest[ContextT]:
        """Inject skills documentation into a model request's system message.

        Args:
            request: Model request to modify

        Returns:
            New model request with skills documentation injected into system message
        """
        skills_metadata = request.state.get("skills_metadata", [])
        skills_list = self._format_skills_list(skills_metadata)

        skills_section = self.system_prompt_template.format(
            skills_list=skills_list,
        )

        new_system_message = append_to_system_message(request.system_message, skills_section)

        return request.override(system_message=new_system_message)

    def before_agent(self, state: SkillsState, runtime: Runtime, config: RunnableConfig) -> SkillsStateUpdate | None:  # ty: ignore[invalid-method-override]
        """Load skills metadata before agent execution (synchronous).

        Loads skills once per session from all configured sources. If
        `skills_metadata` is already present in state (from a prior turn or
        checkpointed session), the load is skipped and `None` is returned.

        Skills are loaded in source order with later sources overriding
        earlier ones if they contain skills with the same name (last one wins).

        Args:
            state: Current agent state.
            runtime: Runtime context.
            config: Runnable config.

        Returns:
            State update with `skills_metadata` populated, or `None` if already present.
        """
        # Skip if skills_metadata is already present in state (even if empty)
        if "skills_metadata" in state:
            return None

        # Resolve backend (supports both direct instances and factory functions)
        backend = self._get_backend(state, runtime, config)
        all_skills: dict[str, SkillMetadata] = {}
        preferred_locale = _preferred_skill_locale(state, config)

        # Load skills from each source in order
        # Later sources override earlier ones (last one wins)
        for source_path in self.sources:
            source_skills = _list_skills(
                backend,
                source_path,
                preferred_locale=preferred_locale,
            )
            for skill in source_skills:
                all_skills[skill["name"]] = skill

        skills = list(all_skills.values())
        return SkillsStateUpdate(skills_metadata=skills)

    async def abefore_agent(self, state: SkillsState, runtime: Runtime, config: RunnableConfig) -> SkillsStateUpdate | None:  # ty: ignore[invalid-method-override]
        """Load skills metadata before agent execution (async).

        Loads skills once per session from all configured sources. If
        `skills_metadata` is already present in state (from a prior turn or
        checkpointed session), the load is skipped and `None` is returned.

        Skills are loaded in source order with later sources overriding
        earlier ones if they contain skills with the same name (last one wins).

        Args:
            state: Current agent state.
            runtime: Runtime context.
            config: Runnable config.

        Returns:
            State update with `skills_metadata` populated, or `None` if already present.
        """
        # Skip if skills_metadata is already present in state (even if empty)
        if "skills_metadata" in state:
            return None

        # Resolve backend (supports both direct instances and factory functions)
        backend = self._get_backend(state, runtime, config)
        all_skills: dict[str, SkillMetadata] = {}
        preferred_locale = _preferred_skill_locale(state, config)

        # Load skills from each source in order
        # Later sources override earlier ones (last one wins)
        for source_path in self.sources:
            source_skills = await _alist_skills(
                backend,
                source_path,
                preferred_locale=preferred_locale,
            )
            for skill in source_skills:
                all_skills[skill["name"]] = skill

        skills = list(all_skills.values())
        return SkillsStateUpdate(skills_metadata=skills)

    def wrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[[ModelRequest[ContextT]], ModelResponse[ResponseT]],
    ) -> ModelResponse[ResponseT]:
        """Inject skills documentation into the system prompt.

        Args:
            request: Model request being processed
            handler: Handler function to call with modified request

        Returns:
            Model response from handler
        """
        modified_request = self.modify_request(request)
        return handler(modified_request)

    async def awrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[[ModelRequest[ContextT]], Awaitable[ModelResponse[ResponseT]]],
    ) -> ModelResponse[ResponseT]:
        """Inject skills documentation into the system prompt (async version).

        Args:
            request: Model request being processed
            handler: Async handler function to call with modified request

        Returns:
            Model response from handler
        """
        modified_request = self.modify_request(request)
        return await handler(modified_request)


__all__ = ["SkillMetadata", "SkillsMiddleware"]
