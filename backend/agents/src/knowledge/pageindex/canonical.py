from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
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

    if companion_path is not None:
        content = companion_path.read_text(encoding="utf-8")
        if content.strip():
            return CanonicalDocument(
                markdown=content,
                page_count=page_count,
                used_markdown_companion=True,
                pages=pages,
            )

    if normalized_kind == "docx":
        extracted_markdown = _extract_docx_markdown(source_path)
        if extracted_markdown.strip():
            return CanonicalDocument(
                markdown=extracted_markdown,
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


def _extract_docx_markdown(source_path: Path) -> str:
    if source_path.suffix.lower() != ".docx" or not source_path.is_file():
        return ""
    try:
        with zipfile.ZipFile(source_path) as archive:
            with archive.open("word/document.xml") as document_xml:
                root = ET.parse(document_xml).getroot()
    except Exception:
        return ""

    parts: list[str] = []
    body = root.find("w:body", _WORD_NS)
    if body is None:
        return ""

    for child in list(body):
        tag_name = _local_name(child.tag)
        if tag_name == "p":
            paragraph_text = _paragraph_text(child)
            if not paragraph_text:
                continue
            heading_level = _paragraph_heading_level(child)
            if heading_level is not None:
                parts.append(f"{'#' * heading_level} {paragraph_text}")
            else:
                parts.append(paragraph_text)
            parts.append("")
            continue
        if tag_name == "tbl":
            table_lines = _table_markdown(child)
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
