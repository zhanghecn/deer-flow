from __future__ import annotations

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.knowledge import KnowledgeService
from src.knowledge.runtime import resolve_knowledge_runtime_identity


def _runtime_identity(runtime: ToolRuntime[ContextT, ThreadState]) -> tuple[str, str]:
    return resolve_knowledge_runtime_identity(getattr(runtime, "context", None))


@tool("list_knowledge_documents", parse_docstring=True)
def list_knowledge_documents(
    runtime: ToolRuntime[ContextT, ThreadState],
) -> str:
    """List thread-attached knowledge documents and their descriptions.

    Use this tool first when the user asks about uploaded knowledge files, refers to a document by name,
    or when you need to decide which attached knowledge document to inspect.
    After choosing a document, continue with the knowledge tools instead of switching to grep, read_file,
    or shell inspection unless you are explicitly debugging indexing/parsing problems.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().list_thread_documents(user_id=user_id, thread_id=thread_id)


@tool("get_document_tree", parse_docstring=True)
def get_document_tree(
    runtime: ToolRuntime[ContextT, ThreadState],
    document_name_or_id: str,
    node_id: str | None = None,
    max_depth: int = 2,
) -> str:
    """Inspect a document_tree window for one attached knowledge document.

    Use this after list_knowledge_documents to inspect the root tree or a subtree.
    The response includes nested child branches, titles, summaries, and page or line ranges.
    It does not include the full source text.

    Args:
        document_name_or_id: Exact document name or document id from list_knowledge_documents.
        node_id: Optional node id whose subtree should be returned. Omit this to inspect the root tree.
        max_depth: Maximum nested depth to return from the requested subtree.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_document_tree(
        user_id=user_id,
        thread_id=thread_id,
        document_name_or_id=document_name_or_id,
        node_id=node_id,
        max_depth=max_depth,
    )


@tool("get_document_tree_node_detail", parse_docstring=True)
def get_document_tree_node_detail(
    runtime: ToolRuntime[ContextT, ThreadState],
    document_name_or_id: str,
    node_ids: str,
) -> str:
    """Read source text and citation metadata for one or more document_tree nodes.

    Use this when you have identified promising nodes and need grounded source text.
    Pass one or more node ids as a comma-separated string such as "0007" or "0007,0008,0012".
    The response is JSON with one item per node. For PDFs it also includes per-page text chunks with
    single-page citation_markdown values. Copy the returned citation_markdown exactly into your visible answer.
    This tool is the normal way to read document text for indexed knowledge retrieval; avoid grep/read_file
    over the same document unless the knowledge index clearly failed to expose the needed content.

    Args:
        document_name_or_id: Exact document name or document id from list_knowledge_documents.
        node_ids: One or more node ids separated by commas.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_document_tree_node_detail(
        user_id=user_id,
        thread_id=thread_id,
        document_name_or_id=document_name_or_id,
        node_ids=node_ids,
    )


@tool("get_document_image", parse_docstring=True)
def get_document_image(
    runtime: ToolRuntime[ContextT, ThreadState],
    document_name_or_id: str,
    page_number: int,
) -> str:
    """Export a PDF page image for visual inspection.

    Use this after get_document_tree_node_detail when a relevant PDF page contains a figure, chart,
    or diagram that needs visual inspection. The response includes an image_path that can be passed
    to view_image(image_path=...) when the current model supports vision.

    Args:
        document_name_or_id: Exact document name or document id from list_knowledge_documents.
        page_number: 1-based PDF page number to render as an image.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_document_image(
        user_id=user_id,
        thread_id=thread_id,
        document_name_or_id=document_name_or_id,
        page_number=page_number,
    )
