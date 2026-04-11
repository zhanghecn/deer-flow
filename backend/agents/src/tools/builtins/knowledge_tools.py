from __future__ import annotations

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.knowledge import KnowledgeService
from src.knowledge.runtime import resolve_knowledge_runtime_identity


def _runtime_identity(runtime: ToolRuntime[ContextT, ThreadState]) -> tuple[str, str]:
    return resolve_knowledge_runtime_identity(getattr(runtime, "context", None))


@tool("get_document_tree", parse_docstring=True)
def get_document_tree(
    runtime: ToolRuntime[ContextT, ThreadState],
    document_name_or_id: str,
    node_id: str | None = None,
    max_depth: int = 2,
    root_cursor: int = 0,
) -> str:
    """Inspect a document_tree window for one attached knowledge document.

    Use this after choosing a ready document from the middleware-injected
    <knowledge_attached_documents> prompt block.
    Root and subtree windows are capped at max_depth=2 even if you request a larger number.
    For large documents, the root call may intentionally collapse to a top-level overview only,
    even when you requested max_depth=2. When that happens, the payload reports
    window_mode=root_overview and collapsed_root_overview=true. Pick a relevant root node_id and
    call this tool again with node_id=... to expand that branch. If the current root overview is
    paginated, the payload also reports next_root_cursor / previous_root_cursor; call this tool
    again with root_cursor=... to inspect another root slice instead of reading /large_tool_results.
    To go deeper, call this tool again with node_id set to the most relevant branch instead of
    asking for a larger max_depth. The response includes nested child branches, titles, normalized
    summaries, and page or line ranges, but not the full source text. If a result is offloaded to
    /large_tool_results/..., treat that as a scope-too-broad signal and call this tool again with
    a narrower node_id instead of using grep/read_file on the spill file.

    Args:
        document_name_or_id: Document id or exact document name from the attached knowledge prompt.
            Prefer the injected ASCII document_id when available.
        node_id: Optional node id whose subtree should be returned. Omit this to inspect the root tree.
        max_depth: Requested nested depth for the subtree window. Values above 2 are clamped to 2.
        root_cursor: Zero-based root overview cursor. Use the next_root_cursor or previous_root_cursor
            returned by an earlier collapsed root overview when the document has many top-level branches.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_document_tree(
        user_id=user_id,
        thread_id=thread_id,
        document_name_or_id=document_name_or_id,
        node_id=node_id,
        max_depth=max_depth,
        root_cursor=root_cursor,
    )


@tool("get_document_evidence", parse_docstring=True)
def get_document_evidence(
    runtime: ToolRuntime[ContextT, ThreadState],
    document_name_or_id: str,
    node_ids: str,
) -> str:
    """Read grounded text, visual evidence blocks, and exact citations for one or more document_tree nodes.

    Use this after get_document_tree when you have identified the most relevant nodes.
    Pass one or more node ids as a comma-separated string such as "0007" or "0007,0008,0012".
    The response is JSON with one item per node, grounded text, exact citation_markdown values, and
    evidence_blocks that may include inline-ready image_markdown for relevant figures or pages.
    When a visual evidence block includes display_markdown, prefer copying that exact value because
    it keeps the image and citation together in one grounded snippet.
    Prefer this tool over manually combining get_document_tree_node_detail + get_document_image.
    Copy citation_markdown exactly into the visible answer. If an evidence block includes image_markdown
    and the image materially helps the user, include it naturally in the answer instead of only mentioning
    that an image exists.

    Args:
        document_name_or_id: Document id or exact document name from the attached knowledge prompt.
            Prefer the injected ASCII document_id when available.
        node_ids: One or more node ids separated by commas.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_document_evidence(
        user_id=user_id,
        thread_id=thread_id,
        document_name_or_id=document_name_or_id,
        node_ids=node_ids,
    )


@tool("get_document_tree_node_detail", parse_docstring=True)
def get_document_tree_node_detail(
    runtime: ToolRuntime[ContextT, ThreadState],
    document_name_or_id: str,
    node_ids: str,
) -> str:
    """Read source text and citation metadata for one or more document_tree nodes.

    Opt-in compatibility tool. This is not part of the default agent tool set.
    Prefer get_document_evidence(...) for normal retrieval flows and use this only
    when an explicitly enabled workflow needs raw grounded text slices without the
    richer evidence bundle.
    Pass one or more node ids as a comma-separated string such as "0007" or "0007,0008,0012".
    The response is JSON with one item per node. For PDFs it also includes per-page text chunks with
    single-page citation_markdown values. Copy the returned citation_markdown exactly into your visible answer.
    This tool is the normal way to read document text for indexed knowledge retrieval; avoid grep/read_file
    over the same document unless the knowledge index clearly failed to expose the needed content.

    Args:
        document_name_or_id: Document id or exact document name from the attached knowledge prompt.
            Prefer the injected ASCII document_id when available.
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

    Specialized visual inspection tool. Prefer get_document_evidence(...) for the main knowledge flow.
    Use this after get_document_evidence when a relevant PDF page contains a figure, chart,
    diagram, or layout question that needs ad-hoc visual inspection. The response includes an image_path that can be
    passed to view_image(image_path=...) when the current model supports vision. If the answer depends on what the
    page looks like, do not treat present_files(image_path) or raw image_paths from node detail as a substitute for
    visual inspection; call view_image(image_path=...) first, then answer.

    Args:
        document_name_or_id: Document id or exact document name from the attached knowledge prompt.
            Prefer the injected ASCII document_id when available.
        page_number: 1-based PDF page number to render as an image.
    """
    user_id, thread_id = _runtime_identity(runtime)
    return KnowledgeService().get_document_image(
        user_id=user_id,
        thread_id=thread_id,
        document_name_or_id=document_name_or_id,
        page_number=page_number,
    )
