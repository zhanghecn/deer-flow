from __future__ import annotations

import sys

from src.knowledge.source_workspace import build_source_workspace_document


def test_build_source_workspace_document_uses_full_markdown_without_tree_index(tmp_path) -> None:
    source = tmp_path / "case.md"
    source.write_text("# 案例\n\n壬寅日主丑月出生。", encoding="utf-8")

    source_document = build_source_workspace_document(
        source_path=source,
        file_kind="markdown",
        display_name="case.md",
    )
    assert source_document.canonical_markdown == "# 案例\n\n壬寅日主丑月出生。"
    # The source workspace path imports only canonical conversion. It must not
    # initialize the old tree index package, because that would keep the
    # chunk/tree path in the runtime build loop.
    assert "src.knowledge.pageindex" not in sys.modules
