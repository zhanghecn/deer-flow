"""Middleware for providing subagents to an agent via a `task` tool."""

import json
import re
import warnings
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import Annotated, Any, NotRequired, TypedDict, Unpack, cast

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware, InterruptOnConfig
from langchain.agents.middleware.types import AgentMiddleware, ContextT, ModelRequest, ModelResponse, ResponseT
from langchain.chat_models import init_chat_model
from langchain.tools import BaseTool, ToolRuntime
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, ToolMessage
from langchain_core.runnables import Runnable
from langchain_core.tools import StructuredTool
from langgraph.types import Command

from deepagents.backends.protocol import BackendFactory, BackendProtocol
from deepagents.middleware._utils import append_to_system_message


class SubAgent(TypedDict):
    """Specification for an agent.

    When using `create_deep_agent`, subagents automatically receive a default middleware
    stack (TodoListMiddleware, FilesystemMiddleware, SummarizationMiddleware, etc.) before
    any custom `middleware` specified in this spec.

    Required fields:
        name: Unique identifier for the subagent.

            The main agent uses this name when calling the `task()` tool.
        description: What this subagent does.

            Be specific and action-oriented. The main agent uses this to decide when to delegate.
        system_prompt: Instructions for the subagent.

            Include tool usage guidance and output format requirements.

    Optional fields:
        tools: Tools the subagent can use.

            If not specified, inherits tools from the main agent via `default_tools`.
        model: Override the main agent's model.

            Use the format `'provider:model-name'` (e.g., `'openai:gpt-4o'`).
        middleware: Additional middleware for custom behavior, logging, or rate limiting.
        interrupt_on: Configure human-in-the-loop for specific tools.

            Requires a checkpointer.
        skills: Skill source paths for SkillsMiddleware.

            List of paths to skill directories (e.g., `["/skills/user/", "/skills/project/"]`).
    """

    name: str
    """Unique identifier for the subagent."""

    description: str
    """What this subagent does. The main agent uses this to decide when to delegate."""

    system_prompt: str
    """Instructions for the subagent."""

    tools: NotRequired[Sequence[BaseTool | Callable | dict[str, Any]]]
    """Tools the subagent can use. If not specified, inherits from main agent."""

    model: NotRequired[str | BaseChatModel]
    """Override the main agent's model. Use `'provider:model-name'` format."""

    middleware: NotRequired[list[AgentMiddleware]]
    """Additional middleware for custom behavior."""

    filesystem_enabled: NotRequired[bool]
    """Whether this subagent receives filesystem and shell middleware tools.

    Defaults to the parent deep agent's filesystem setting. Product runtimes can
    disable this for judge/validator subagents whose tool surface must be an
    explicit whitelist, while leaving general-purpose agents unchanged.
    """

    interrupt_on: NotRequired[dict[str, bool | InterruptOnConfig]]
    """Configure human-in-the-loop for specific tools."""

    skills: NotRequired[list[str]]
    """Skill source paths for SkillsMiddleware."""


class CompiledSubAgent(TypedDict):
    """A pre-compiled agent spec.

    !!! note

        The runnable's state schema must include a 'messages' key.

        This is required for the subagent to communicate results back to the main agent.

    When the subagent completes, the final message in the 'messages' list will be
    extracted and returned as a `ToolMessage` to the parent agent.
    """

    name: str
    """Unique identifier for the subagent."""

    description: str
    """What this subagent does."""

    runnable: Runnable
    """A custom agent implementation.

    Create a custom agent using either:

    1. LangChain's [`create_agent()`](https://docs.langchain.com/oss/python/langchain/quickstart)
    2. A custom graph using [`langgraph`](https://docs.langchain.com/oss/python/langgraph/quickstart)

    If you're creating a custom graph, make sure the state schema includes a 'messages' key.
    This is required for the subagent to communicate results back to the main agent.
    """


DEFAULT_SUBAGENT_PROMPT = "In order to complete the objective that the user asks of you, you have access to a number of standard tools."

# State keys that are excluded when passing state to subagents and when returning
# updates from subagents.
#
# When returning updates:
# 1. The messages key is handled explicitly to ensure only the final message is included
# 2. The todos and structured_response keys are excluded as they do not have a defined reducer
#    and no clear meaning for returning them from a subagent to the main agent.
# 3. The skills_metadata and memory_contents keys are automatically excluded from subagent output
#    via PrivateStateAttr annotations on their respective state schemas. However, they must ALSO
#    be explicitly filtered from runtime.state when invoking a subagent to prevent parent state
#    from leaking to child agents (e.g., the general-purpose subagent loads its own skills via
#    SkillsMiddleware).
_EXCLUDED_STATE_KEYS = {"messages", "todos", "structured_response", "skills_metadata", "memory_contents"}

TASK_TOOL_DESCRIPTION = """Launch an ephemeral subagent to handle complex, multi-step independent tasks with isolated context windows.

Available agent types and the tools they have access to:
{available_agents}

When using the Task tool:
- `description` is a short 3-5 word label for the delegated task
- `prompt` is the full task briefing for the subagent
- `subagent_type` selects a specialized agent when you need one
- If `subagent_type` is omitted, the general-purpose agent is used

When NOT to use the Task tool:
- If you already know the specific file path, use `read_file` directly.
- If you are doing a quick filename/pattern lookup, use `glob` directly.
- If the task is a short, single-step action with no context pressure, execute it directly.

## Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
2. When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
3. Each agent invocation is stateless. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report. Therefore, your `prompt` should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
4. The agent's outputs should generally be trusted
5. Clearly tell the agent whether you expect it to create content, perform analysis, or just do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
6. If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
7. When only the general-purpose agent is provided, you should use it for all tasks. It is great for isolating context and token usage, and completing specific, complex tasks, as it has all the same capabilities as the main agent.

## Writing the prompt
- Brief the subagent like a smart colleague who has not seen this conversation.
- Explain the goal, why it matters, and what you already know or ruled out.
- Include exact file paths, commands, or output requirements when they matter.
- Avoid terse command-only prompts for nuanced work; they usually produce shallow results.
- Do not push the synthesis step onto the subagent with vague phrasing like "based on your findings, fix it." Write the concrete task you want done.

### Example usage of the general-purpose agent:

<example_agent_descriptions>
"general-purpose": use this agent for general purpose tasks, it has access to all tools as the main agent.
</example_agent_descriptions>

<example>
User: "I want to conduct research on the accomplishments of Lebron James, Michael Jordan, and Kobe Bryant, and then compare them."
Assistant: *Uses the task tool in parallel to conduct isolated research on each of the three players*
Assistant: *Synthesizes the results of the three isolated research tasks and responds to the User*
<commentary>
Research is a complex, multi-step task in it of itself.
The research of each individual player is not dependent on the research of the other players.
The assistant uses the task tool to break down the complex objective into three isolated tasks.
Each research task only needs to worry about context and tokens about one player, then returns synthesized information about each player as the Tool Result.
This means each research task can dive deep and spend tokens and context deeply researching each player, but the final result is synthesized information, and saves us tokens in the long run when comparing the players to each other.
</commentary>
</example>

<example>
User: "Analyze a single large code repository for security vulnerabilities and generate a report."
Assistant: *Launches a single `task` subagent for the repository analysis*
Assistant: *Receives report and integrates results into final summary*
<commentary>
Subagent is used to isolate a large, context-heavy task, even though there is only one. This prevents the main thread from being overloaded with details.
If the user then asks followup questions, we have a concise report to reference instead of the entire history of analysis and tool calls, which is good and saves us time and money.
</commentary>
</example>

<example>
User: "Schedule two meetings for me and prepare agendas for each."
Assistant: *Calls the task tool in parallel to launch two `task` subagents (one per meeting) to prepare agendas*
Assistant: *Returns final schedules and agendas*
<commentary>
Tasks are simple individually, but subagents help silo agenda preparation.
Each subagent only needs to worry about the agenda for one meeting.
</commentary>
</example>

<example>
User: "I want to order a pizza from Dominos, order a burger from McDonald's, and order a salad from Subway."
Assistant: *Calls tools directly in parallel to order a pizza from Dominos, a burger from McDonald's, and a salad from Subway*
<commentary>
The assistant did not use the task tool because the objective is super simple and clear and only requires a few trivial tool calls.
It is better to just complete the task directly and NOT use the `task`tool.
</commentary>
</example>

### Example usage with custom agents:

<example_agent_descriptions>
"content-reviewer": use this agent after you are done creating significant content or documents
"greeting-responder": use this agent when to respond to user greetings with a friendly joke
"research-analyst": use this agent to conduct thorough research on complex topics
</example_agent_description>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {{
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {{
    if (n % i === 0) return false
  }}
  return true
}}
</code>
<commentary>
Since significant content was created and the task was completed, now use the content-reviewer agent to review the work
</commentary>
assistant: Now let me use the content-reviewer agent to review the code
assistant: Uses the Task tool to launch with the content-reviewer agent
</example>

<example>
user: "Can you help me research the environmental impact of different renewable energy sources and create a comprehensive report?"
<commentary>
This is a complex research task that would benefit from using the research-analyst agent to conduct thorough analysis
</commentary>
assistant: I'll help you research the environmental impact of renewable energy sources. Let me use the research-analyst agent to conduct comprehensive research on this topic.
assistant: Uses the Task tool to launch with the research-analyst agent, providing detailed instructions about what research to conduct and what format the report should take
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Task tool to launch with the greeting-responder agent"
</example>"""  # noqa: E501

TASK_SYSTEM_PROMPT = """## `task` (subagent spawner)

You have access to a `task` tool to launch short-lived subagents that handle isolated tasks. These agents are ephemeral — they live only for the duration of the task and return a single result.

When to use the task tool:
- When a task is complex and multi-step, and can be fully delegated in isolation
- When a task is independent of other tasks and can run in parallel
- When a task requires focused reasoning or heavy token/context usage that would bloat the orchestrator thread
- When sandboxing improves reliability (e.g. code execution, structured searches, data formatting)
- When you only care about the output of the subagent, and not the intermediate steps (ex. performing a lot of research and then returned a synthesized report, performing a series of computations or lookups to achieve a concise, relevant answer.)

Subagent lifecycle:
1. **Spawn** → Provide clear role, instructions, and expected output
2. **Run** → The subagent completes the task autonomously
3. **Return** → The subagent provides a single structured result
4. **Reconcile** → Incorporate or synthesize the result into the main thread

When NOT to use the task tool:
- If you need to see the intermediate reasoning or steps after the subagent has completed (the task tool hides them)
- If the task is trivial (a few tool calls or simple lookup)
- If delegating does not reduce token usage, complexity, or context switching
- If splitting would add latency without benefit

## Important Task Tool Usage Notes to Remember
- Parallelize independent work when it helps, but keep stateful mutations sequential. Do not batch `write_file`, `edit_file`, or shell commands that touch the same files or depend on earlier results.
- Remember to use the `task` tool to silo independent tasks within a multi-part objective.
- You should use the `task` tool whenever you have a complex task that will take multiple steps, and is independent from other tasks that the agent needs to complete. These agents are highly competent and efficient."""  # noqa: E501


DEFAULT_GENERAL_PURPOSE_DESCRIPTION = "General-purpose agent for researching complex questions, searching for files and content, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. This agent has access to all tools as the main agent."  # noqa: E501

# Base spec for general-purpose subagent (caller adds model, tools, middleware)
GENERAL_PURPOSE_SUBAGENT: SubAgent = {
    "name": "general-purpose",
    "description": DEFAULT_GENERAL_PURPOSE_DESCRIPTION,
    "system_prompt": DEFAULT_SUBAGENT_PROMPT,
}

TASK_AUDIT_SCHEMA_VERSION = "openagents-task-audit/v1"
TASK_AUDIT_DIR = "/mnt/user-data/workspace/.openagents-task-audit/task-calls"
TASK_AUDIT_TAG_RE = re.compile(r"<openagents_task_audit>\s*(\{.*?\})\s*</openagents_task_audit>", re.DOTALL)
RUNTIME_TASK_AUDIT_TAG = "openagents_runtime_task_audit"
TASK_AUDIT_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")


def _is_existing_file_write_error(error: str) -> bool:
    """Detect backend write failures caused by an already-persisted audit file."""
    normalized = error.lower()
    return "already exists" in normalized or "file exists" in normalized


def _audit_attempt_suffix(tool_call_id: str) -> str:
    """Build a lexically sortable suffix for repeated attempts of one audit id."""
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    sanitized_tool_call_id = re.sub(r"[^A-Za-z0-9_.:-]+", "_", tool_call_id.strip())
    if sanitized_tool_call_id:
        return f"{timestamp}--{sanitized_tool_call_id}"
    return timestamp


class _SubagentSpec(TypedDict):
    """Internal spec for building the task tool."""

    name: str
    description: str
    runnable: Runnable


def _get_subagents_legacy(
    *,
    default_model: str | BaseChatModel,
    default_tools: Sequence[BaseTool | Callable | dict[str, Any]],
    default_middleware: list[AgentMiddleware] | None,
    default_interrupt_on: dict[str, bool | InterruptOnConfig] | None,
    subagents: list[SubAgent | CompiledSubAgent],
    general_purpose_agent: bool,
) -> list[_SubagentSpec]:
    """Create subagent instances from specifications.

    Args:
        default_model: Default model for subagents that don't specify one.
        default_tools: Default tools for subagents that don't specify tools.
        default_middleware: Middleware to apply to all subagents. If `None`,
            no default middleware is applied.
        default_interrupt_on: The tool configs to use for the default general-purpose subagent. These
            are also the fallback for any subagents that don't specify their own tool configs.
        subagents: List of agent specifications or pre-compiled agents.
        general_purpose_agent: Whether to include a general-purpose subagent.

    Returns:
        List of subagent specs containing name, description, and runnable.
    """
    # Use empty list if None (no default middleware)
    default_subagent_middleware = default_middleware or []

    specs: list[_SubagentSpec] = []

    # Create general-purpose agent if enabled
    if general_purpose_agent:
        general_purpose_middleware = [*default_subagent_middleware]
        if default_interrupt_on:
            general_purpose_middleware.append(HumanInTheLoopMiddleware(interrupt_on=default_interrupt_on))
        general_purpose_subagent = create_agent(
            default_model,
            system_prompt=DEFAULT_SUBAGENT_PROMPT,
            tools=default_tools,
            middleware=general_purpose_middleware,
            name="general-purpose",
        )
        specs.append(
            {
                "name": "general-purpose",
                "description": DEFAULT_GENERAL_PURPOSE_DESCRIPTION,
                "runnable": general_purpose_subagent,
            }
        )

    # Process custom subagents
    for agent_ in subagents:
        if "runnable" in agent_:
            custom_agent = cast("CompiledSubAgent", agent_)
            specs.append(
                {
                    "name": custom_agent["name"],
                    "description": custom_agent["description"],
                    "runnable": custom_agent["runnable"],
                }
            )
            continue
        _tools = agent_.get("tools", list(default_tools))

        subagent_model = agent_.get("model", default_model)

        _middleware = [*default_subagent_middleware, *agent_["middleware"]] if "middleware" in agent_ else [*default_subagent_middleware]

        interrupt_on = agent_.get("interrupt_on", default_interrupt_on)
        if interrupt_on:
            _middleware.append(HumanInTheLoopMiddleware(interrupt_on=interrupt_on))

        specs.append(
            {
                "name": agent_["name"],
                "description": agent_["description"],
                "runnable": create_agent(
                    subagent_model,
                    system_prompt=agent_["system_prompt"],
                    tools=_tools,
                    middleware=_middleware,
                    name=agent_["name"],
                ),
            }
        )

    return specs


def _build_task_tool(  # noqa: C901
    subagents: list[_SubagentSpec],
    task_description: str | None = None,
    backend: BackendProtocol | BackendFactory | None = None,
) -> BaseTool:
    """Create a task tool from pre-built subagent graphs.

    This is the shared implementation used by both the legacy API and new API.

    Args:
        subagents: List of subagent specs containing name, description, and runnable.
        task_description: Custom description for the task tool. If `None`,
            uses default template. Supports `{available_agents}` placeholder.

    Returns:
        A StructuredTool that can invoke subagents by type.
    """
    # Build the graphs dict and descriptions from the unified spec list
    subagent_graphs: dict[str, Runnable] = {spec["name"]: spec["runnable"] for spec in subagents}
    subagent_description_str = "\n".join(f"- {s['name']}: {s['description']}" for s in subagents)

    # Use custom description if provided, otherwise use default template
    if task_description is None:
        description = TASK_TOOL_DESCRIPTION.format(available_agents=subagent_description_str)
    elif "{available_agents}" in task_description:
        description = task_description.format(available_agents=subagent_description_str)
    else:
        description = task_description

    def _resolve_backend(runtime: ToolRuntime) -> BackendProtocol | None:
        """Resolve the runtime backend used for generic task audit persistence."""
        if backend is None:
            return None
        if callable(backend):
            return backend(runtime)  # ty: ignore[call-arg]
        return backend

    def _runtime_owned_writer(resolved_backend: BackendProtocol | None, *, async_mode: bool = False) -> Any:
        """Find the privileged runtime-owned writer behind logging wrappers."""
        current = resolved_backend
        seen: set[int] = set()
        method_name = "awrite_runtime_owned_file" if async_mode else "write_runtime_owned_file"
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            writer = getattr(current, method_name, None)
            if callable(writer):
                return writer
            current = getattr(current, "__wrapped_backend__", None)
        return None

    def _sanitize_audit_id(value: str | None, tool_call_id: str) -> str:
        """Return a path-safe audit id without deriving any business meaning."""
        candidate = str(value or "").strip()
        if candidate and TASK_AUDIT_ID_RE.fullmatch(candidate):
            return candidate
        fallback = re.sub(r"[^A-Za-z0-9_.:-]+", "_", tool_call_id.strip())
        return fallback or "task-call"

    def _extract_json_audit_payload(message_text: str) -> dict[str, Any]:
        """Extract audit metadata from a JSON-first subagent result.

        The task tool contract stays limited to description/prompt/subagent_type.
        When a subagent already returns a machine-readable JSON object, the
        runtime can safely read an explicit top-level audit_id from that payload
        without adding another model-visible task argument or parsing prose.
        """
        stripped = message_text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
        index = 0
        while index < len(stripped) and stripped[index].isspace():
            index += 1
        if index >= len(stripped) or stripped[index] != "{":
            return {}
        try:
            payload, _end = json.JSONDecoder().raw_decode(stripped[index:])
        except json.JSONDecodeError:
            return {}
        if not isinstance(payload, dict):
            return {}
        audit_id = payload.get("audit_id")
        if not isinstance(audit_id, str) or not audit_id.strip():
            return {}
        audit_payload: dict[str, Any] = {"audit_id": audit_id.strip()}
        output_file = payload.get("output_file")
        if isinstance(output_file, str) and output_file.strip():
            audit_payload["output_file"] = output_file.strip()
        return audit_payload

    def _extract_audit_tag(message_text: str) -> tuple[dict[str, Any], str]:
        """Extract optional machine-readable task audit metadata from child output."""
        match = TASK_AUDIT_TAG_RE.search(message_text)
        if not match:
            return _extract_json_audit_payload(message_text), message_text
        cleaned_text = TASK_AUDIT_TAG_RE.sub("", message_text).rstrip()
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            return {"tag_parse_error": "openagents_task_audit JSON 解析失败"}, cleaned_text
        if not isinstance(payload, dict):
            return {"tag_parse_error": "openagents_task_audit 必须是对象"}, cleaned_text
        return payload, cleaned_text

    def _extract_message_text(message: Any) -> str:
        """Return text from a child final message across provider content shapes."""
        text_attr = getattr(message, "text", None)
        if isinstance(text_attr, str) and text_attr:
            return text_attr.rstrip()
        if callable(text_attr):
            text_value = text_attr()
            if isinstance(text_value, str) and text_value:
                return text_value.rstrip()

        content = getattr(message, "content", "")
        if isinstance(content, str):
            return content.rstrip()
        if not isinstance(content, list):
            return ""

        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
        return "\n".join(parts).rstrip()

    def _build_task_audit_payload(
        *,
        tool_call_id: str,
        audit_id: str,
        subagent_type: str,
        description: str,
        prompt: str,
        status: str,
        result_text: str = "",
        error: str | None = None,
        tag_payload: dict[str, Any] | None = None,
        audit_file: str,
    ) -> dict[str, Any]:
        """Build a generic runtime task audit without domain-specific fields."""
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        payload: dict[str, Any] = {
            "schema_version": TASK_AUDIT_SCHEMA_VERSION,
            "audit_id": audit_id,
            "audit_file": audit_file,
            "tool_call_id": tool_call_id,
            "subagent_type": subagent_type,
            "description": description,
            "status": status,
            "started_at": now,
            "finished_at": now,
            "result_text": result_text,
            # Store only a short prompt preview/hash-equivalent length signal so
            # audits remain useful without duplicating large delegated prompts.
            "prompt_preview": prompt[:500],
            "prompt_length": len(prompt),
        }
        if error:
            payload["error"] = error
        if tag_payload:
            payload["tag_payload"] = tag_payload
            if tag_payload.get("output_file"):
                payload["output_file"] = tag_payload["output_file"]
        return payload

    def _append_runtime_task_audit_tag(message_text: str, audit_payload: dict[str, Any]) -> str:
        """Expose the runtime-authored audit identity to the parent model.

        The child model may omit or mis-state its optional audit tag. The
        runtime-owned audit file is the durable proof, so the task result
        carries only that resolved id/path back to the orchestrator. A separate
        tag name avoids feeding this metadata back into `_extract_audit_tag`
        when a nested subagent summarizes another task result.
        """
        marker_payload = {
            "audit_id": audit_payload.get("audit_id"),
            "audit_file": audit_payload.get("audit_file"),
            "tool_call_id": audit_payload.get("tool_call_id"),
            "subagent_type": audit_payload.get("subagent_type"),
            "status": audit_payload.get("status"),
        }
        marker = json.dumps(marker_payload, ensure_ascii=False, separators=(",", ":"))
        return f"{message_text.rstrip()}\n\n<{RUNTIME_TASK_AUDIT_TAG}>{marker}</{RUNTIME_TASK_AUDIT_TAG}>"

    def _write_task_audit(
        *,
        runtime: ToolRuntime,
        subagent_type: str,
        description: str,
        prompt: str,
        result_text: str = "",
        error: str | None = None,
        tag_payload: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any] | None, str | None]:
        """Persist a task audit through the active backend path contract."""
        audit_id = _sanitize_audit_id((tag_payload or {}).get("audit_id"), runtime.tool_call_id or "")
        audit_file = f"{TASK_AUDIT_DIR}/{audit_id}.json"
        payload = _build_task_audit_payload(
            tool_call_id=runtime.tool_call_id or "",
            audit_id=audit_id,
            subagent_type=subagent_type,
            description=description,
            prompt=prompt,
            status="error" if error else "completed",
            result_text=result_text,
            error=error,
            tag_payload=tag_payload,
            audit_file=audit_file,
        )
        resolved_backend = _resolve_backend(runtime)
        if resolved_backend is None:
            return payload, None, None
        # Task audits are runtime-owned handoff files. They are written via the
        # same path contract, but through a privileged backend hook so normal
        # model file tools cannot forge or patch audit evidence.
        privileged_write = _runtime_owned_writer(resolved_backend)
        write_result = (privileged_write or resolved_backend.write)(
            audit_file,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        )
        if write_result.error and _is_existing_file_write_error(write_result.error):
            # A logical audit id may be retried after a validator blocks a stage.
            # Keep the model-facing audit_id stable, but move later attempts to
            # unique files so the model never has to delete or forge runtime
            # audit records to continue.
            audit_file = f"{TASK_AUDIT_DIR}/{audit_id}--{_audit_attempt_suffix(runtime.tool_call_id or '')}.json"
            payload["audit_file"] = audit_file
            write_result = (privileged_write or resolved_backend.write)(
                audit_file,
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            )
        if write_result.error:
            return payload, write_result.files_update, write_result.error
        return payload, write_result.files_update, None

    async def _awrite_task_audit(
        *,
        runtime: ToolRuntime,
        subagent_type: str,
        description: str,
        prompt: str,
        result_text: str = "",
        error: str | None = None,
        tag_payload: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any] | None, str | None]:
        """Async variant of task-audit persistence for async tool execution."""
        audit_id = _sanitize_audit_id((tag_payload or {}).get("audit_id"), runtime.tool_call_id or "")
        audit_file = f"{TASK_AUDIT_DIR}/{audit_id}.json"
        payload = _build_task_audit_payload(
            tool_call_id=runtime.tool_call_id or "",
            audit_id=audit_id,
            subagent_type=subagent_type,
            description=description,
            prompt=prompt,
            status="error" if error else "completed",
            result_text=result_text,
            error=error,
            tag_payload=tag_payload,
            audit_file=audit_file,
        )
        resolved_backend = _resolve_backend(runtime)
        if resolved_backend is None:
            return payload, None, None
        privileged_awrite = _runtime_owned_writer(resolved_backend, async_mode=True)
        write_result = await (privileged_awrite or resolved_backend.awrite)(
            audit_file,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        )
        if write_result.error and _is_existing_file_write_error(write_result.error):
            # Async subagent paths follow the same retry semantics as the sync
            # path: repeated logical audit ids get new attempt files while the
            # payload's audit_id remains the stable value requested by the child.
            audit_file = f"{TASK_AUDIT_DIR}/{audit_id}--{_audit_attempt_suffix(runtime.tool_call_id or '')}.json"
            payload["audit_file"] = audit_file
            write_result = await (privileged_awrite or resolved_backend.awrite)(
                audit_file,
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            )
        if write_result.error:
            return payload, write_result.files_update, write_result.error
        return payload, write_result.files_update, None

    def _command_for_task_error(
        *,
        tool_call_id: str,
        message: str,
        files_update: dict[str, Any] | None = None,
    ) -> Command:
        """Return a visible task error while preserving backend state updates."""
        update: dict[str, Any] = {
            "messages": [ToolMessage(message, tool_call_id=tool_call_id)],
        }
        if files_update is not None:
            update["files"] = files_update
        return Command(update=update)

    def _return_command_with_state_update(
        result: dict,
        *,
        runtime: ToolRuntime,
        subagent_type: str,
        description: str,
        prompt: str,
    ) -> Command:
        # Validate that the result contains a 'messages' key
        if "messages" not in result:
            error_msg = (
                "CompiledSubAgent must return a state containing a 'messages' key. "
                "Custom StateGraphs used with CompiledSubAgent should include 'messages' "
                "in their state schema to communicate results back to the main agent."
            )
            raise ValueError(error_msg)

        state_update = {k: v for k, v in result.items() if k not in _EXCLUDED_STATE_KEYS}
        # Strip trailing whitespace to prevent provider API errors, but keep
        # content-block text because some chat adapters do not populate `.text`.
        message_text = _extract_message_text(result["messages"][-1])
        tag_payload, audit_result_text = _extract_audit_tag(message_text)
        if not audit_result_text.strip():
            _, files_update, audit_error = _write_task_audit(
                runtime=runtime,
                subagent_type=subagent_type,
                description=description,
                prompt=prompt,
                result_text=audit_result_text,
                error="Subagent returned an empty final message.",
                tag_payload=tag_payload,
            )
            message = (
                f"Error invoking subagent {subagent_type}: subagent returned an empty final message. "
                "Retry with a narrower prompt or different subagent; do not treat this task as completed."
            )
            if audit_error:
                message += f"\nError: failed to write task audit: {audit_error}"
            return _command_for_task_error(
                tool_call_id=runtime.tool_call_id or "",
                message=message,
                files_update=files_update,
            )
        audit_payload, files_update, audit_error = _write_task_audit(
            runtime=runtime,
            subagent_type=subagent_type,
            description=description,
            prompt=prompt,
            result_text=audit_result_text,
            tag_payload=tag_payload,
        )
        if audit_error:
            return _command_for_task_error(
                tool_call_id=runtime.tool_call_id or "",
                message=f"Error: failed to write task audit: {audit_error}",
                files_update=files_update,
            )
        if files_update is not None:
            existing_files = state_update.get("files")
            if isinstance(existing_files, dict):
                state_update["files"] = {**existing_files, **files_update}
            else:
                state_update["files"] = files_update
        return Command(
            update={
                **state_update,
                "messages": [
                    ToolMessage(
                        _append_runtime_task_audit_tag(audit_result_text, audit_payload),
                        tool_call_id=runtime.tool_call_id,
                    )
                ],
            }
        )

    def _build_delegated_message(*, prompt: str) -> str:
        """Return the exact child-task briefing seen by the delegated subagent.

        Claude Code keeps task semantics inside one `prompt` field instead of
        splitting them across multiple optional schema slots. We mirror that
        contract here so the model only has to choose a short label, a detailed
        prompt, and an optional agent type.
        """
        return prompt.strip()

    def _validate_and_prepare_state(
        subagent_type: str | None,
        prompt: str,
        runtime: ToolRuntime,
    ) -> tuple[Runnable, dict]:
        """Prepare state for invocation."""
        # Claude Code falls back to the general-purpose agent when the caller
        # omits `subagent_type` outside fork mode. DeepAgents has no fork path
        # here, so the same fallback preserves the minimal contract.
        effective_subagent_type = subagent_type or "general-purpose"
        subagent = subagent_graphs[effective_subagent_type]
        # Create a new state dict to avoid mutating the original
        subagent_state = {k: v for k, v in runtime.state.items() if k not in _EXCLUDED_STATE_KEYS}
        subagent_state["messages"] = [
            HumanMessage(
                content=_build_delegated_message(prompt=prompt)
            )
        ]
        return subagent, subagent_state

    def task(
        description: Annotated[
            str,
            "A short 3-5 word description of the delegated task.",
        ],
        prompt: Annotated[
            str,
            "The full task briefing for the subagent. Include the goal, relevant context, what is already known, and the exact output you want back.",
        ],
        runtime: ToolRuntime,
        subagent_type: Annotated[
            str | None,
            "Optional specialized subagent type. If omitted, the general-purpose agent is used.",
        ] = None,
    ) -> str | Command:
        effective_subagent_type = subagent_type or "general-purpose"
        if effective_subagent_type not in subagent_graphs:
            allowed_types = ", ".join([f"`{k}`" for k in subagent_graphs])
            return f"We cannot invoke subagent {effective_subagent_type} because it does not exist, the only allowed types are {allowed_types}"
        if not runtime.tool_call_id:
            value_error_msg = "Tool call ID is required for subagent invocation"
            raise ValueError(value_error_msg)
        subagent, subagent_state = _validate_and_prepare_state(
            effective_subagent_type,
            prompt,
            runtime,
        )
        try:
            result = subagent.invoke(subagent_state)
        except Exception as exc:  # noqa: BLE001 - task tool must surface child-run failures to the parent model.
            _, files_update, audit_error = _write_task_audit(
                runtime=runtime,
                subagent_type=effective_subagent_type,
                description=description,
                prompt=prompt,
                error=str(exc),
            )
            message = f"Error invoking subagent {effective_subagent_type}: {exc}"
            if audit_error:
                message += f"\nError: failed to write task audit: {audit_error}"
            return _command_for_task_error(
                tool_call_id=runtime.tool_call_id,
                message=message,
                files_update=files_update,
            )
        return _return_command_with_state_update(
            result,
            runtime=runtime,
            subagent_type=effective_subagent_type,
            description=description,
            prompt=prompt,
        )

    async def atask(
        description: Annotated[
            str,
            "A short 3-5 word description of the delegated task.",
        ],
        prompt: Annotated[
            str,
            "The full task briefing for the subagent. Include the goal, relevant context, what is already known, and the exact output you want back.",
        ],
        runtime: ToolRuntime,
        subagent_type: Annotated[
            str | None,
            "Optional specialized subagent type. If omitted, the general-purpose agent is used.",
        ] = None,
    ) -> str | Command:
        effective_subagent_type = subagent_type or "general-purpose"
        if effective_subagent_type not in subagent_graphs:
            allowed_types = ", ".join([f"`{k}`" for k in subagent_graphs])
            return f"We cannot invoke subagent {effective_subagent_type} because it does not exist, the only allowed types are {allowed_types}"
        if not runtime.tool_call_id:
            value_error_msg = "Tool call ID is required for subagent invocation"
            raise ValueError(value_error_msg)
        subagent, subagent_state = _validate_and_prepare_state(
            effective_subagent_type,
            prompt,
            runtime,
        )
        try:
            result = await subagent.ainvoke(subagent_state)
        except Exception as exc:  # noqa: BLE001 - task tool must surface child-run failures to the parent model.
            _, files_update, audit_error = await _awrite_task_audit(
                runtime=runtime,
                subagent_type=effective_subagent_type,
                description=description,
                prompt=prompt,
                error=str(exc),
            )
            message = f"Error invoking subagent {effective_subagent_type}: {exc}"
            if audit_error:
                message += f"\nError: failed to write task audit: {audit_error}"
            return _command_for_task_error(
                tool_call_id=runtime.tool_call_id,
                message=message,
                files_update=files_update,
            )
        if "messages" not in result:
            error_msg = (
                "CompiledSubAgent must return a state containing a 'messages' key. "
                "Custom StateGraphs used with CompiledSubAgent should include 'messages' "
                "in their state schema to communicate results back to the main agent."
            )
            raise ValueError(error_msg)

        message_text = _extract_message_text(result["messages"][-1])
        tag_payload, audit_result_text = _extract_audit_tag(message_text)
        if not audit_result_text.strip():
            _, files_update, audit_error = await _awrite_task_audit(
                runtime=runtime,
                subagent_type=effective_subagent_type,
                description=description,
                prompt=prompt,
                result_text=audit_result_text,
                error="Subagent returned an empty final message.",
                tag_payload=tag_payload,
            )
            message = (
                f"Error invoking subagent {effective_subagent_type}: subagent returned an empty final message. "
                "Retry with a narrower prompt or different subagent; do not treat this task as completed."
            )
            if audit_error:
                message += f"\nError: failed to write task audit: {audit_error}"
            return _command_for_task_error(
                tool_call_id=runtime.tool_call_id,
                message=message,
                files_update=files_update,
            )
        audit_payload, files_update, audit_error = await _awrite_task_audit(
            runtime=runtime,
            subagent_type=effective_subagent_type,
            description=description,
            prompt=prompt,
            result_text=audit_result_text,
            tag_payload=tag_payload,
        )
        if audit_error:
            return _command_for_task_error(
                tool_call_id=runtime.tool_call_id,
                message=f"Error: failed to write task audit: {audit_error}",
                files_update=files_update,
            )

        state_update = {k: v for k, v in result.items() if k not in _EXCLUDED_STATE_KEYS}
        if files_update is not None:
            existing_files = state_update.get("files")
            if isinstance(existing_files, dict):
                state_update["files"] = {**existing_files, **files_update}
            else:
                state_update["files"] = files_update
        return Command(
            update={
                **state_update,
                "messages": [
                    ToolMessage(
                        _append_runtime_task_audit_tag(audit_result_text, audit_payload),
                        tool_call_id=runtime.tool_call_id,
                    )
                ],
            }
        )

    return StructuredTool.from_function(
        name="task",
        func=task,
        coroutine=atask,
        description=description,
    )


class _DeprecatedKwargs(TypedDict, total=False):
    """TypedDict for deprecated SubAgentMiddleware keyword arguments.

    These arguments are deprecated and will be removed in version 0.5.0.
    Use `backend` and fully-specified `subagents` instead.
    """


class SubAgentMiddleware(AgentMiddleware[Any, ContextT, ResponseT]):
    """Middleware for providing subagents to an agent via a `task` tool.

    This middleware adds a `task` tool to the agent that can be used to invoke subagents.
    Subagents are useful for handling complex tasks that require multiple steps, or tasks
    that require a lot of context to resolve.

    A chief benefit of subagents is that they can handle multi-step tasks, and then return
    a clean, concise response to the main agent.

    Subagents are also great for different domains of expertise that require a narrower
    subset of tools and focus.

    Args:
        backend: Backend for file operations and execution. Required for the new API.
        subagents: List of fully-specified subagent configs. Each SubAgent
            must specify `model` and `tools`. Optional `interrupt_on` on
            individual subagents is respected.
        system_prompt: Instructions appended to main agent's system prompt
            about how to use the task tool.
        task_description: Custom description for the task tool.

    Example:
        ```python
        from deepagents.middleware import SubAgentMiddleware
        from langchain.agents import create_agent

        agent = create_agent(
            "openai:gpt-4o",
            middleware=[
                SubAgentMiddleware(
                    backend=my_backend,
                    subagents=[
                        {
                            "name": "researcher",
                            "description": "Research agent",
                            "system_prompt": "You are a researcher.",
                            "model": "openai:gpt-4o",
                            "tools": [search_tool],
                        }
                    ],
                )
            ],
        )
        ```

    .. deprecated::
        The following arguments are deprecated and will be removed in version 0.5.0:
        `default_model`, `default_tools`, `default_middleware`,
        `default_interrupt_on`, `general_purpose_agent`. Use `backend` and `subagents` instead.
    """

    # Valid deprecated kwarg names for runtime validation
    _VALID_DEPRECATED_KWARGS = frozenset(
        {
            "default_model",
            "default_tools",
            "default_middleware",
            "default_interrupt_on",
            "general_purpose_agent",
        }
    )

    def __init__(
        self,
        *,
        backend: BackendProtocol | BackendFactory | None = None,
        subagents: list[SubAgent | CompiledSubAgent] | None = None,
        system_prompt: str | None = TASK_SYSTEM_PROMPT,
        task_description: str | None = None,
        **deprecated_kwargs: Unpack[_DeprecatedKwargs],
    ) -> None:
        """Initialize the `SubAgentMiddleware`."""
        super().__init__()

        # Validate that only known deprecated kwargs are passed
        unknown_kwargs = set(deprecated_kwargs.keys()) - self._VALID_DEPRECATED_KWARGS
        if unknown_kwargs:
            msg = f"SubAgentMiddleware got unexpected keyword argument(s): {', '.join(sorted(unknown_kwargs))}"
            raise TypeError(msg)

        # Handle deprecated kwargs for backward compatibility
        default_model = deprecated_kwargs.get("default_model")
        default_tools = deprecated_kwargs.get("default_tools")
        default_middleware = deprecated_kwargs.get("default_middleware")
        default_interrupt_on = deprecated_kwargs.get("default_interrupt_on")
        # general_purpose_agent defaults to True if not specified
        general_purpose_agent = deprecated_kwargs.get("general_purpose_agent", True)

        # Warn about any deprecated kwargs that were provided
        provided_deprecated = [key for key in deprecated_kwargs if key != "general_purpose_agent"]
        if "general_purpose_agent" in deprecated_kwargs and not general_purpose_agent:
            provided_deprecated.append("general_purpose_agent")

        if provided_deprecated:
            warnings.warn(
                f"The following SubAgentMiddleware arguments are deprecated and will be removed "
                f"in version 0.5.0: {', '.join(provided_deprecated)}. "
                f"Use `backend` and fully-specified `subagents` instead.",
                DeprecationWarning,
                stacklevel=2,
            )

        # Detect which API is being used
        using_new_api = backend is not None
        using_old_api = default_model is not None

        if using_old_api and not using_new_api:
            # Legacy API - build subagents from deprecated args
            subagent_specs = _get_subagents_legacy(
                default_model=default_model,  # ty: ignore[invalid-argument-type]
                default_tools=default_tools or [],
                default_middleware=default_middleware,
                default_interrupt_on=default_interrupt_on,
                subagents=subagents or [],
                general_purpose_agent=general_purpose_agent,
            )
        elif using_new_api:
            if not subagents:
                msg = "At least one subagent must be specified when using the new API"
                raise ValueError(msg)
            self._backend = backend
            self._subagents = subagents
            subagent_specs = self._get_subagents()
        else:
            msg = "SubAgentMiddleware requires either `backend` (new API) or `default_model` (deprecated API)"
            raise ValueError(msg)

        task_tool = _build_task_tool(subagent_specs, task_description, backend=backend if using_new_api else None)

        # Build system prompt with available agents
        if system_prompt and subagent_specs:
            agents_desc = "\n".join(f"- {s['name']}: {s['description']}" for s in subagent_specs)
            self.system_prompt = system_prompt + "\n\nAvailable subagent types:\n" + agents_desc
        else:
            self.system_prompt = system_prompt

        self.tools = [task_tool]

    def _get_subagents(self) -> list[_SubagentSpec]:
        """Create runnable agents from specs.

        Returns:
            List of subagent specs with name, description, and runnable.
        """
        specs: list[_SubagentSpec] = []

        for spec in self._subagents:
            if "runnable" in spec:
                # CompiledSubAgent - use as-is
                compiled = cast("CompiledSubAgent", spec)
                specs.append({"name": compiled["name"], "description": compiled["description"], "runnable": compiled["runnable"]})
                continue

            # SubAgent - validate required fields
            if "model" not in spec:
                msg = f"SubAgent '{spec['name']}' must specify 'model'"
                raise ValueError(msg)
            if "tools" not in spec:
                msg = f"SubAgent '{spec['name']}' must specify 'tools'"
                raise ValueError(msg)

            # Resolve model if string
            model = spec["model"]
            if isinstance(model, str):
                model = init_chat_model(model)

            # Use middleware as provided (caller is responsible for building full stack)
            middleware: list[AgentMiddleware] = list(spec.get("middleware", []))

            interrupt_on = spec.get("interrupt_on")
            if interrupt_on:
                middleware.append(HumanInTheLoopMiddleware(interrupt_on=interrupt_on))

            specs.append(
                {
                    "name": spec["name"],
                    "description": spec["description"],
                    "runnable": create_agent(
                        model,
                        system_prompt=spec["system_prompt"],
                        tools=spec["tools"],
                        middleware=middleware,
                        name=spec["name"],
                    ),
                }
            )

        return specs

    def wrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[[ModelRequest[ContextT]], ModelResponse[ResponseT]],
    ) -> ModelResponse[ResponseT]:
        """Update the system message to include instructions on using subagents."""
        if self.system_prompt is not None:
            new_system_message = append_to_system_message(request.system_message, self.system_prompt)
            return handler(request.override(system_message=new_system_message))
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[[ModelRequest[ContextT]], Awaitable[ModelResponse[ResponseT]]],
    ) -> ModelResponse[ResponseT]:
        """(async) Update the system message to include instructions on using subagents."""
        if self.system_prompt is not None:
            new_system_message = append_to_system_message(request.system_message, self.system_prompt)
            return await handler(request.override(system_message=new_system_message))
        return await handler(request)
