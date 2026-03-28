from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import zipfile

_CANONICAL_PATH = (
    Path(__file__).resolve().parents[1] / "src/knowledge/pageindex/canonical.py"
)
_SPEC = importlib.util.spec_from_file_location("knowledge_pageindex_canonical", _CANONICAL_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_MODULE = importlib.util.module_from_spec(_SPEC)
try:
    import pymupdf as _pymupdf  # noqa: F401
except ImportError:
    sys.modules.setdefault("pymupdf", types.SimpleNamespace())
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)
build_canonical_document = _MODULE.build_canonical_document
_extract_docx_markdown = _MODULE._extract_docx_markdown


def _paragraph_xml(text: str) -> str:
    return (
        "<w:p>"
        "<w:r>"
        f"<w:t>{text}</w:t>"
        "</w:r>"
        "</w:p>"
    )


def _write_minimal_docx(path: Path, paragraphs: list[str]) -> None:
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        + "".join(_paragraph_xml(text) for text in paragraphs)
        + "</w:body>"
        "</w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)


def test_extract_docx_markdown_infers_headings_without_word_styles(tmp_path: Path):
    docx_path = tmp_path / "sample.docx"
    _write_minimal_docx(
        docx_path,
        [
            "段建业盲派命理干支解密",
            "段建业盲派命理干支解密",
            "盲派",
            "一、盲派特点",
            "1、放弃了日主旺衰，以研究命局的象，也就是表述来论命。",
            "这是一套新的命理体系，必须放弃旧的理论思想。",
            "乾：乙丙甲甲",
            "未戌子戌",
            "未中之根被戌去，从格，去子水印星，因此是个当官的，走到午运特别好。",
            "从军之命：",
            "劫财七杀两相连，从小离家戌边防。既劫财七杀为从军之命。",
        ],
    )

    markdown = _extract_docx_markdown(docx_path)

    assert markdown.startswith("# 段建业盲派命理干支解密\n")
    assert markdown.count("段建业盲派命理干支解密") == 1
    assert "## 盲派\n" in markdown
    assert "## 一、盲派特点\n" in markdown
    assert "### 1、放弃了日主旺衰，以研究命局的象，也就是表述来论命。\n" in markdown
    assert "## 未戌子戌\n" not in markdown
    assert "\n未戌子戌\n" in markdown
    assert "### 从军之命：\n" in markdown


def test_build_canonical_document_prefers_structured_docx_markdown_over_flat_companion(
    tmp_path: Path,
):
    docx_path = tmp_path / "sample.docx"
    companion_path = tmp_path / "sample.md"
    _write_minimal_docx(
        docx_path,
        [
            "段建业盲派命理干支解密",
            "段建业盲派命理干支解密",
            "盲派",
            "一、盲派特点",
            "1、放弃了日主旺衰，以研究命局的象，也就是表述来论命。",
            "这是一套新的命理体系，必须放弃旧的理论思想。",
        ],
    )
    companion_path.write_text(
        "\n".join(
            [
                "段建业盲派命理干支解密",
                "",
                "盲派",
                "",
                "一、 盲派特点",
                "",
                "1、 放弃了日主旺衰，以研究命局的象，也就是表述来论命。",
            ]
        ),
        encoding="utf-8",
    )

    canonical = build_canonical_document(
        source_path=docx_path,
        file_kind="docx",
        markdown_path=companion_path,
        preview_path=None,
    )

    assert canonical.used_markdown_companion is False
    assert canonical.markdown.startswith("# 段建业盲派命理干支解密\n")
    assert "## 一、盲派特点\n" in canonical.markdown
    assert "### 1、放弃了日主旺衰，以研究命局的象，也就是表述来论命。\n" in canonical.markdown
