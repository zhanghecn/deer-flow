from __future__ import annotations

from pathlib import Path

from src.knowledge.models import SourceDocument
from src.knowledge.canonical import build_canonical_document


def build_source_workspace_document(
    *,
    source_path: Path,
    file_kind: str,
    display_name: str,
    markdown_path: Path | None = None,
    preview_path: Path | None = None,
) -> SourceDocument:
    """Normalize one uploaded document into full source Markdown.

    This intentionally stops after deterministic conversion. The agent-facing
    knowledge contract is filesystem retrieval over original/canonical source
    text through `glob`, `grep`, and `read_file`.
    """

    normalized_kind = file_kind.lower().strip()
    canonical = build_canonical_document(
        source_path=source_path,
        file_kind=normalized_kind,
        markdown_path=markdown_path,
        preview_path=preview_path,
    )
    if not canonical.markdown.strip():
        raise ValueError(
            f"Could not build readable Markdown for {display_name}. "
            "Provide a converted markdown companion or a preview PDF for this file."
        )

    return SourceDocument(
        display_name=display_name,
        file_name=source_path.name,
        file_kind=normalized_kind,
        locator_type="heading" if normalized_kind == "markdown" else "page",
        page_count=canonical.page_count,
        # Keep descriptions extractive and predictable. Agent reasoning should
        # inspect the mounted source files instead of trusting generated KB
        # summaries as a parallel truth source.
        doc_description=f"Source document: {display_name}",
        canonical_markdown=canonical.markdown,
        build_quality="ready",
        quality_metadata={
            "source_workspace_mode": "source_markdown",
            "used_markdown_companion": canonical.used_markdown_companion,
        },
    )
