from __future__ import annotations

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.knowledge import KnowledgeService
from src.knowledge.runtime import resolve_knowledge_runtime_identity


def _runtime_identity(runtime: ToolRuntime[ContextT, ThreadState]) -> tuple[str, str]:
    return resolve_knowledge_runtime_identity(getattr(runtime, "context", None))


@tool("search_knowledge_workspace", parse_docstring=True)
def search_knowledge_workspace(
    runtime: ToolRuntime[ContextT, ThreadState],
    query: str,
    workspace_name_or_id: str | None = None,
    limit: int = 10,
) -> str:
    """Search attached llm-wiki style knowledge workspaces.

    This is the default first step for questions over attached knowledge.
    It searches generated `wiki/**/*.md` pages plus bounded raw-source line
    evidence across the attached workspaces unless workspace_name_or_id narrows
    the scope. Use exact workspace_id values from <knowledge_attached_workspaces>
    when available.

    Args:
        query: The natural-language or keyword query to search for.
        workspace_name_or_id: Optional workspace id or exact workspace name.
        limit: Maximum number of ranked results to return, capped by the runtime.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().search_knowledge_workspace(
        user_id=user_id,
        thread_id=thread_id,
        query=query,
        workspace_name_or_id=workspace_name_or_id,
        limit=limit,
    )


@tool("get_wiki_page", parse_docstring=True)
def get_wiki_page(
    runtime: ToolRuntime[ContextT, ThreadState],
    workspace_name_or_id: str,
    page_path: str,
) -> str:
    """Read a generated wiki page from an attached knowledge workspace.

    Use this after search_knowledge_workspace returns a relevant page path.
    The page_path must be a workspace-relative path such as
    `wiki/sources/source-name.md`.

    Args:
        workspace_name_or_id: Workspace id or exact workspace name from <knowledge_attached_workspaces>.
        page_path: Workspace-relative wiki page path.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_wiki_page(
        user_id=user_id,
        thread_id=thread_id,
        workspace_name_or_id=workspace_name_or_id,
        page_path=page_path,
    )


@tool("get_source_evidence", parse_docstring=True)
def get_source_evidence(
    runtime: ToolRuntime[ContextT, ThreadState],
    workspace_name_or_id: str,
    query: str,
    source_path_or_name: str | None = None,
    max_snippets: int = 5,
    line_start: int | None = None,
    line_limit: int = 80,
) -> str:
    """Read narrow original-source snippets from a knowledge workspace raw cache.

    Use this when a wiki page indicates that the answer needs original extracted
    source text. The tool searches `raw/sources/.cache/**` and returns bounded
    snippets instead of exposing full raw files to the model. When
    search_knowledge_workspace returns a source_path and line_start, pass those
    values here with line_limit to read a bounded line-numbered excerpt.

    Args:
        workspace_name_or_id: Workspace id or exact workspace name from <knowledge_attached_workspaces>.
        query: Query used to locate snippets inside extracted source text.
        source_path_or_name: Optional raw cache path or filename substring to narrow the source.
        max_snippets: Maximum snippets to return.
        line_start: Optional 1-based source line to read from when expanding a search hit.
        line_limit: Maximum number of lines to return when line_start is provided.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_source_evidence(
        user_id=user_id,
        thread_id=thread_id,
        workspace_name_or_id=workspace_name_or_id,
        query=query,
        source_path_or_name=source_path_or_name,
        max_snippets=max_snippets,
        line_start=line_start,
        line_limit=line_limit,
    )


@tool("get_knowledge_graph", parse_docstring=True)
def get_knowledge_graph(
    runtime: ToolRuntime[ContextT, ThreadState],
    workspace_name_or_id: str | None = None,
) -> str:
    """Inspect the wiki graph for attached knowledge workspaces.

    The graph is built from generated wiki pages and `[[wikilink]]`
    references, with relevance weights based on links, shared sources, common
    neighbors, and type affinity.

    Args:
        workspace_name_or_id: Optional workspace id or exact workspace name.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_knowledge_graph(
        user_id=user_id,
        thread_id=thread_id,
        workspace_name_or_id=workspace_name_or_id,
    )


@tool("get_workspace_file_tree", parse_docstring=True)
def get_workspace_file_tree(
    runtime: ToolRuntime[ContextT, ThreadState],
    workspace_name_or_id: str | None = None,
) -> str:
    """List files in attached llm-wiki style knowledge workspaces.

    Use this for navigation or debugging the generated workspace structure.
    For answering knowledge questions, prefer search_knowledge_workspace first.

    Args:
        workspace_name_or_id: Optional workspace id or exact workspace name.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_workspace_file_tree(
        user_id=user_id,
        thread_id=thread_id,
        workspace_name_or_id=workspace_name_or_id,
    )
