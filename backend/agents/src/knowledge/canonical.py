from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from xml.etree import ElementTree as ET
import zipfile

import pymupdf


@dataclass
class CanonicalPage:
    page_number: int
    text: str
    markdown_text: str
    image_paths: list[Path]


@dataclass
class CanonicalDocument:
    markdown: str
    page_count: int | None
    used_markdown_companion: bool
    pages: list[CanonicalPage]


def build_canonical_document(
    *,
    source_path: Path,
    file_kind: str,
    markdown_path: Path | None,
    preview_path: Path | None,
) -> CanonicalDocument:
    normalized_kind = file_kind.lower().strip()
    if normalized_kind == "markdown":
        return CanonicalDocument(
            markdown=source_path.read_text(encoding="utf-8"),
            page_count=None,
            used_markdown_companion=False,
            pages=[],
        )

    companion_path = markdown_path if markdown_path and markdown_path.is_file() else None
    page_source_path = _page_source_path(source_path=source_path, preview_path=preview_path)
    page_count = _page_count(page_source_path)
    pages = _extract_pdf_pages(page_source_path) if page_source_path is not None else []
    extracted_docx_markdown = (
        _extract_docx_markdown(source_path) if normalized_kind == "docx" else ""
    )

    if companion_path is not None:
        content = companion_path.read_text(encoding="utf-8")
        if content.strip():
            if normalized_kind == "docx":
                preferred_markdown, used_markdown_companion = _select_docx_markdown(
                    companion_markdown=content,
                    extracted_markdown=extracted_docx_markdown,
                )
                return CanonicalDocument(
                    markdown=preferred_markdown,
                    page_count=page_count,
                    used_markdown_companion=used_markdown_companion,
                    pages=pages,
                )
            return CanonicalDocument(
                markdown=content,
                page_count=page_count,
                used_markdown_companion=True,
                pages=pages,
            )

    if normalized_kind == "docx":
        if extracted_docx_markdown.strip():
            return CanonicalDocument(
                markdown=extracted_docx_markdown,
                page_count=None,
                used_markdown_companion=False,
                pages=[],
            )

    if page_source_path is None:
        return CanonicalDocument(
            markdown="",
            page_count=None,
            used_markdown_companion=False,
            pages=[],
        )

    return CanonicalDocument(
        markdown=_page_markdown(pages),
        page_count=page_count,
        used_markdown_companion=False,
        pages=pages,
    )


def _select_docx_markdown(
    *,
    companion_markdown: str,
    extracted_markdown: str,
) -> tuple[str, bool]:
    companion_text = companion_markdown.strip()
    extracted_text = extracted_markdown.strip()
    if not companion_text:
        return extracted_markdown, False
    if not extracted_text:
        return companion_markdown, True
    if _markdown_heading_count(extracted_markdown) > _markdown_heading_count(companion_markdown):
        return extracted_markdown, False
    return companion_markdown, True


def _markdown_heading_count(markdown: str) -> int:
    return sum(1 for line in markdown.splitlines() if re.match(r"^\s{0,3}#{1,6}\s+\S", line))


def _page_source_path(*, source_path: Path, preview_path: Path | None) -> Path | None:
    if preview_path is not None and preview_path.is_file():
        return preview_path
    if source_path.suffix.lower() == ".pdf" and source_path.is_file():
        return source_path
    return None


def _page_count(pdf_path: Path | None) -> int | None:
    if pdf_path is None:
        return None
    doc = pymupdf.open(pdf_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def _extract_pdf_pages(pdf_path: Path) -> list[CanonicalPage]:
    doc = pymupdf.open(pdf_path)
    try:
        pages: list[CanonicalPage] = []
        asset_dir = pdf_path.with_name(f"{pdf_path.stem}.assets")
        for page_index, page in enumerate(doc, start=1):
            page_text = page.get_text("text").strip()
            image_paths = _extract_page_images(
                doc=doc,
                page=page,
                page_number=page_index,
                asset_dir=asset_dir,
                base_dir=pdf_path.parent,
            )
            body_parts: list[str] = []
            if page_text:
                body_parts.append(page_text)
            for image_index, image_path in enumerate(image_paths, start=1):
                image_id = f"img-p{page_index:04d}-{image_index:02d}"
                relative_path = image_path.relative_to(pdf_path.parent).as_posix()
                body_parts.append("")
                body_parts.append(
                    f"<!-- OA_IMAGE id={image_id} page={page_index} path={relative_path} -->"
                )
                body_parts.append(f"![{image_id}]({relative_path})")
            pages.append(
                CanonicalPage(
                    page_number=page_index,
                    text=page_text,
                    markdown_text="\n".join(part for part in body_parts if part is not None).strip(),
                    image_paths=image_paths,
                )
            )
        return pages
    finally:
        doc.close()


def _page_markdown(pages: list[CanonicalPage]) -> str:
    parts: list[str] = []
    for page in pages:
        parts.append(f"<!-- OA_PAGE {page.page_number} -->")
        parts.append(f"## Page {page.page_number}")
        if page.markdown_text:
            parts.append("")
            parts.append(page.markdown_text)
        parts.append("")
    return "\n".join(parts).strip() + "\n"


def _extract_page_images(
    *,
    doc: pymupdf.Document,
    page: pymupdf.Page,
    page_number: int,
    asset_dir: Path,
    base_dir: Path,
) -> list[Path]:
    images: list[Path] = []
    for image_index, image_info in enumerate(page.get_images(full=True), start=1):
        xref = int(image_info[0])
        try:
            extracted = doc.extract_image(xref)
        except Exception:
            continue
        image_bytes = extracted.get("image")
        extension = str(extracted.get("ext") or "png").strip().lower() or "png"
        if not image_bytes:
            continue
        asset_dir.mkdir(parents=True, exist_ok=True)
        image_path = asset_dir / f"img-p{page_number:04d}-{image_index:02d}.{extension}"
        if not image_path.exists():
            image_path.write_bytes(image_bytes)
        if image_path.is_file() and image_path.is_relative_to(base_dir):
            images.append(image_path)
        elif image_path.is_file():
            images.append(image_path)
    return images


_WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_DOCX_SECTION_RE = re.compile(
    r"^(?:第[0-9一二三四五六七八九十百千万]+[章节篇部分卷]|[一二三四五六七八九十百千万]+[、.．])"
)
_DOCX_SUBSECTION_RE = re.compile(r"^(?:\d+[、.．)]|[（(]?[0-9一二三四五六七八九十百千万]+[)）])")
_DOCX_TRAILING_COLON_HEADING_RE = re.compile(r"^[^。！？；]{2,24}[：:]$")
_DOCX_STEM_BRANCH_CHARS = set("甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥")


@dataclass
class _DocxParagraphInfo:
    text: str
    explicit_heading_level: int | None
    max_font_size: int | None


def _extract_docx_markdown(source_path: Path) -> str:
    if source_path.suffix.lower() != ".docx" or not source_path.is_file():
        return ""
    try:
        with zipfile.ZipFile(source_path) as archive:
            with archive.open("word/document.xml") as document_xml:
                root = ET.parse(document_xml).getroot()
    except Exception:
        return ""

    body = root.find("w:body", _WORD_NS)
    if body is None:
        return ""

    paragraph_infos: list[_DocxParagraphInfo] = []
    blocks: list[tuple[str, _DocxParagraphInfo | ET.Element]] = []
    for child in list(body):
        tag_name = _local_name(child.tag)
        if tag_name == "p":
            paragraph_text = _paragraph_text(child)
            if not paragraph_text:
                continue
            paragraph_info = _DocxParagraphInfo(
                text=paragraph_text,
                explicit_heading_level=_paragraph_heading_level(child),
                max_font_size=_paragraph_max_font_size(child),
            )
            paragraph_infos.append(paragraph_info)
            blocks.append(("p", paragraph_info))
            continue
        if tag_name == "tbl":
            blocks.append(("tbl", child))

    inferred_levels = _infer_docx_heading_levels(paragraph_infos)
    parts: list[str] = []
    previous_paragraph_text = ""
    paragraph_index = 0
    for block_kind, payload in blocks:
        if block_kind == "p":
            paragraph_info = payload
            assert isinstance(paragraph_info, _DocxParagraphInfo)
            text = paragraph_info.text.strip()
            heading_level = inferred_levels[paragraph_index]
            paragraph_index += 1
            if (
                text == previous_paragraph_text
                and len(text) <= 40
                and paragraph_index > 1
                and inferred_levels[paragraph_index - 2] == 1
            ):
                continue
            if heading_level is not None:
                parts.append(f"{'#' * heading_level} {text}")
            else:
                parts.append(text)
            parts.append("")
            previous_paragraph_text = text
            continue

        table_lines = _table_markdown(payload)
        if table_lines:
            parts.extend(table_lines)
            parts.append("")
    return "\n".join(parts).strip() + ("\n" if parts else "")


def _local_name(tag: str) -> str:
    if "}" not in tag:
        return tag
    return tag.rsplit("}", 1)[-1]


def _paragraph_text(paragraph: ET.Element) -> str:
    text_parts = [
        (node.text or "")
        for node in paragraph.findall(".//w:t", _WORD_NS)
        if (node.text or "").strip()
    ]
    return "".join(text_parts).strip()


def _paragraph_heading_level(paragraph: ET.Element) -> int | None:
    style = paragraph.find("w:pPr/w:pStyle", _WORD_NS)
    if style is None:
        return None
    style_value = ""
    for key, value in style.attrib.items():
        if key.endswith("}val") or key == "val":
            style_value = str(value).strip()
            break
    normalized = style_value.lower()
    if not normalized:
        return None
    if normalized.startswith("heading"):
        suffix = normalized.removeprefix("heading")
        if suffix.isdigit():
            return max(1, min(int(suffix), 6))
        return 1
    if normalized in {"title", "标题"}:
        return 1
    if normalized in {"subtitle", "副标题"}:
        return 2
    return None


def _paragraph_max_font_size(paragraph: ET.Element) -> int | None:
    max_size: int | None = None
    for size in paragraph.findall(".//w:rPr/w:sz", _WORD_NS):
        for key, value in size.attrib.items():
            if not (key.endswith("}val") or key == "val"):
                continue
            try:
                parsed = int(str(value).strip())
            except ValueError:
                continue
            max_size = parsed if max_size is None else max(max_size, parsed)
            break
    return max_size


def _infer_docx_heading_levels(
    paragraphs: list[_DocxParagraphInfo],
) -> list[int | None]:
    levels = [paragraph.explicit_heading_level for paragraph in paragraphs]
    if any(level is not None for level in levels):
        return levels

    for index, paragraph in enumerate(paragraphs):
        text = paragraph.text.strip()
        if not text:
            continue
        if index == 0 and len(text) <= 40:
            levels[index] = 1
            continue
        if index > 0 and text == paragraphs[index - 1].text.strip() and levels[index - 1] == 1:
            continue
        next_paragraph = _neighbor_paragraph(paragraphs, index, direction=1)
        next_next_paragraph = _neighbor_paragraph(paragraphs, index, direction=2)
        prev_paragraph = _neighbor_paragraph(paragraphs, index, direction=-1)
        next_text = next_paragraph.text.strip() if next_paragraph is not None else ""
        next_next_text = next_next_paragraph.text.strip() if next_next_paragraph is not None else ""
        prev_text = prev_paragraph.text.strip() if prev_paragraph is not None else ""

        if _looks_like_docx_top_heading(
            text=text,
            previous_text=prev_text,
            next_text=next_text,
            next_next_text=next_next_text,
        ):
            levels[index] = 2
            continue

        if _looks_like_docx_subheading(
            text=text,
            max_font_size=paragraph.max_font_size,
            next_text=next_text,
        ):
            levels[index] = 3

    return levels


def _neighbor_paragraph(
    paragraphs: list[_DocxParagraphInfo],
    index: int,
    *,
    direction: int,
) -> _DocxParagraphInfo | None:
    candidate_index = index + direction
    if candidate_index < 0 or candidate_index >= len(paragraphs):
        return None
    return paragraphs[candidate_index]


def _looks_like_docx_top_heading(
    *,
    text: str,
    previous_text: str,
    next_text: str,
    next_next_text: str,
) -> bool:
    if len(text) > 32 or any(mark in text for mark in "。！？；"):
        return False
    if _looks_like_stem_branch_line(text):
        return False
    if _DOCX_SECTION_RE.match(text):
        return True
    if text.endswith(("断", "诀", "法", "论", "篇")) and len(text) <= 16:
        return True
    if next_text and _DOCX_SECTION_RE.match(next_text) and len(text) <= 16:
        return True
    if ":" in text or "：" in text:
        return False
    if not next_text or len(next_text) <= max(24, len(text) + 4):
        return False
    if next_next_text and len(next_next_text) <= 20:
        return False
    if previous_text and len(previous_text) <= 16 and previous_text == text:
        return False
    return True


def _looks_like_docx_subheading(
    *,
    text: str,
    max_font_size: int | None,
    next_text: str,
) -> bool:
    if len(text) > 96:
        return False
    if _DOCX_SUBSECTION_RE.match(text):
        return len(text) <= 72 or (max_font_size is not None and max_font_size >= 40)
    if _DOCX_TRAILING_COLON_HEADING_RE.match(text):
        return len(next_text) >= 24
    return False


def _looks_like_stem_branch_line(text: str) -> bool:
    normalized = "".join(character for character in text if character not in {" ", "\t", "\n"})
    if not normalized or len(normalized) > 16:
        return False
    return all(character in _DOCX_STEM_BRANCH_CHARS for character in normalized)


def _table_markdown(table: ET.Element) -> list[str]:
    rows: list[list[str]] = []
    for row in table.findall("w:tr", _WORD_NS):
        cells: list[str] = []
        for cell in row.findall("w:tc", _WORD_NS):
            cell_text_parts = []
            for paragraph in cell.findall("w:p", _WORD_NS):
                text = _paragraph_text(paragraph)
                if text:
                    cell_text_parts.append(text)
            cells.append(" ".join(cell_text_parts).strip())
        if any(cell for cell in cells):
            rows.append(cells)
    if not rows:
        return []
    column_count = max(len(row) for row in rows)
    normalized_rows = [row + [""] * (column_count - len(row)) for row in rows]
    header = normalized_rows[0]
    separator = ["---"] * column_count
    body = normalized_rows[1:]
    return [
        "| " + " | ".join(row) + " |"
        for row in [header, separator, *body]
    ]
