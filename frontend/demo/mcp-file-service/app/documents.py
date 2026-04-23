"""Document search and read helpers for the standalone demo MCP service.

This module is intentionally demo-scoped. It gives the 8084 workbench one
reusable document contract without pushing document-specific assumptions into
the generic OpenAgents runtime.
"""

from __future__ import annotations

import base64
import io
import mimetypes
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from docx import Document as WordDocument
from docx.document import Document as WordDocumentType
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook
from openpyxl.chart.title import Title as OpenPyxlTitle
from openpyxl.utils import get_column_letter
from PIL import Image
from pptx import Presentation
from pypdf import PdfReader
from xlrd import open_workbook as open_xls_workbook

DocumentKind = Literal[
    "text",
    "image",
    "pdf",
    "ppt",
    "pptx",
    "doc",
    "docx",
    "xls",
    "xlsx",
]
LocatorType = Literal["line", "page", "slide", "sheet", "region"]
EvidenceType = Literal["text", "ocr_text", "table_text", "vision_summary"]
NextActionHint = Literal[
    "read_current",
    "read_more",
    "fetch_visual",
    "search_next_page",
]

INLINE_ASSET_LIMIT_BYTES = 200_000
IMAGE_EXTENSIONS = {
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".webp",
}
LEGACY_OFFICE_EXTENSIONS = {
    ".doc": "doc",
    ".ppt": "ppt",
    ".xls": "xls",
}
OOXML_OFFICE_EXTENSIONS = {
    ".docx": "docx",
    ".pptx": "pptx",
    ".xlsx": "xlsx",
}
LATIN_STOPWORDS = {
    "a",
    "an",
    "about",
    "does",
    "for",
    "from",
    "how",
    "in",
    "is",
    "me",
    "on",
    "please",
    "show",
    "tell",
    "that",
    "the",
    "this",
    "what",
    "with",
}


@dataclass(frozen=True)
class DocumentAsset:
    """One fetchable or descriptive visual asset surfaced by `document_read`."""

    asset_ref: str
    kind: Literal["image", "document"]
    summary: str
    mime_type: str | None = None
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    data: bytes | None = field(default=None, repr=False)
    extra: dict[str, Any] = field(default_factory=dict)

    def read_block(self, *, locator: str | int) -> dict[str, Any]:
        """Return the compact block shape used by `document_read`."""

        block: dict[str, Any] = {
            "type": "image" if self.kind == "image" else "document",
            "locator": locator,
            "asset_ref": self.asset_ref,
            "summary": self.summary,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "width": self.width,
            "height": self.height,
        }
        if self.extra:
            block["metadata"] = self.extra
        return block

    def fetch_payload(self, *, path: str) -> dict[str, Any]:
        """Inline small binary assets so the demo can verify fetch semantics."""

        payload = {
            "path": path,
            "asset_ref": self.asset_ref,
            "asset_kind": self.kind,
            "summary": self.summary,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "width": self.width,
            "height": self.height,
            "fetchable": self.data is not None,
            "inlined": False,
            "extra": self.extra,
        }
        if self.data is None:
            return payload
        if len(self.data) > INLINE_ASSET_LIMIT_BYTES:
            payload["fetchable"] = False
            payload["warning"] = (
                "asset is larger than the inline demo threshold; "
                "metadata is returned without base64 content"
            )
            return payload
        payload["inlined"] = True
        payload["content_base64"] = base64.b64encode(self.data).decode("ascii")
        return payload


@dataclass(frozen=True)
class DocumentUnit:
    """One addressable unit in a parsed document."""

    locator: str | int
    locator_type: LocatorType
    content_blocks: list[dict[str, Any]]
    search_entries: list[tuple[EvidenceType, str]]
    contains_visual: bool
    preview_text: str


@dataclass(frozen=True)
class ParsedDocument:
    """Structured document view shared by search, read, and asset fetch."""

    path: str
    document_kind: DocumentKind
    locator_type: LocatorType
    units: list[DocumentUnit]
    assets: dict[str, DocumentAsset]
    contains_visual: bool


def _collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _extract_search_terms(query: str) -> list[str]:
    """Keep search forgiving when the agent forwards a natural-language question.

    The generic agent will often send whole user questions into `document_search`
    rather than a single exact keyword. Latin tokenization alone performs badly
    on Chinese prompts, so we additionally derive short CJK n-grams to recover
    terms such as `赔付条款` from longer sentences.
    """

    normalized = _collapse_whitespace(query.lower())
    if not normalized:
        return []

    terms: set[str] = set()
    for token in re.findall(r"[a-z0-9_.:/-]{2,}", normalized):
        if token in LATIN_STOPWORDS:
            continue
        if len(token) < 3 and not any(character.isdigit() for character in token):
            continue
        terms.add(token)

    for run in re.findall(r"[\u4e00-\u9fff]{2,}", query):
        terms.add(run)
        max_length = min(len(run), 8)
        for size in range(max_length, 1, -1):
            for index in range(0, len(run) - size + 1):
                terms.add(run[index : index + size])

    if not terms:
        terms.add(normalized)

    return sorted(terms, key=len, reverse=True)[:32]


def _match_terms(*, terms: list[str], haystack: str) -> tuple[list[str], int]:
    lowered = haystack.lower()
    matched: list[str] = []
    first_index = -1
    for term in terms:
        if term.lower() not in lowered:
            continue
        # Skip short substrings when a longer match already covers the same idea.
        if any(term in winner for winner in matched):
            continue
        matched.append(term)
        if first_index < 0:
            first_index = lowered.index(term.lower())
        if len(matched) >= 3:
            break
    return matched, first_index


def _build_snippet(*, text: str, match_index: int, window: int = 90) -> str:
    if not text:
        return ""
    if match_index < 0:
        return _collapse_whitespace(text[:window])
    start = max(match_index - window // 3, 0)
    end = min(start + window, len(text))
    return _collapse_whitespace(text[start:end])


def _score_match(*, matched_terms: list[str], match_index: int) -> float:
    if not matched_terms:
        return 0.0
    score = float(sum(len(term) for term in matched_terms))
    if match_index == 0:
        score += 2.0
    if len(matched_terms) > 1:
        score += 1.5
    return round(score, 2)


def _next_action_hint(
    *,
    unit_index: int,
    total_units: int,
    contains_visual: bool,
    evidence_type: EvidenceType,
) -> NextActionHint:
    if evidence_type == "vision_summary" or contains_visual:
        return "fetch_visual"
    if unit_index + 1 < total_units:
        return "read_more"
    return "read_current"


def _guess_mime_type(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def _asset_from_bytes(
    *,
    asset_ref: str,
    data: bytes,
    file_name: str,
    summary: str,
    extra: dict[str, Any] | None = None,
) -> DocumentAsset:
    width = None
    height = None
    mime_type = _guess_mime_type(file_name)
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            mime_type = Image.MIME.get(image.format, mime_type)
    except Exception:
        width = None
        height = None
    return DocumentAsset(
        asset_ref=asset_ref,
        kind="image",
        summary=summary,
        mime_type=mime_type,
        size_bytes=len(data),
        width=width,
        height=height,
        data=data,
        extra=extra or {},
    )


def _asset_from_path(*, asset_ref: str, file_path: Path) -> DocumentAsset:
    data = file_path.read_bytes()
    return _asset_from_bytes(
        asset_ref=asset_ref,
        data=data,
        file_name=file_path.name,
        summary=f"Image file {file_path.name}",
        extra={"source": "standalone_image"},
    )


def _table_rows_to_text(rows: list[list[str]]) -> str:
    lines = []
    for row in rows:
        rendered = " | ".join(cell for cell in row if cell.strip())
        if rendered:
            lines.append(rendered)
    return "\n".join(lines)


def _iter_docx_blocks(document: WordDocumentType) -> list[Paragraph | Table]:
    """Preserve paragraph/table order so region cursors stay meaningful."""

    blocks: list[Paragraph | Table] = []
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            blocks.append(Paragraph(child, document))
        elif isinstance(child, CT_Tbl):
            blocks.append(Table(child, document))
    return blocks


def _extract_docx_assets(document: WordDocumentType) -> tuple[dict[str, DocumentAsset], list[str]]:
    assets: dict[str, DocumentAsset] = {}
    ordered_refs: list[str] = []
    image_index = 0
    for relation in document.part.rels.values():
        if "image" not in relation.reltype:
            continue
        image_index += 1
        asset_ref = f"media:image:{image_index}"
        image_name = getattr(relation.target_part, "partname", None)
        file_name = Path(str(image_name)).name if image_name else f"image-{image_index}.bin"
        assets[asset_ref] = _asset_from_bytes(
            asset_ref=asset_ref,
            data=relation.target_part.blob,
            file_name=file_name,
            summary=f"Embedded image {image_index}",
            extra={"source": "docx"},
        )
        ordered_refs.append(asset_ref)
    return assets, ordered_refs


def _chart_summary_text(title: Any, fallback: str) -> str:
    if title is None:
        return fallback
    text = ""
    if hasattr(title, "text_frame"):
        text = getattr(title.text_frame, "text", "") or ""
    elif isinstance(title, OpenPyxlTitle):
        rich = getattr(getattr(title, "tx", None), "rich", None)
        if rich and getattr(rich, "p", None):
            parts: list[str] = []
            for paragraph in rich.p:
                for run in getattr(paragraph, "r", []) or []:
                    if getattr(run, "t", None):
                        parts.append(str(run.t))
                if getattr(paragraph, "endParaRPr", None):
                    continue
            text = " ".join(parts)
    return _collapse_whitespace(text) or fallback


def _extract_sheet_rows(sheet: Any) -> tuple[list[list[str]], str]:
    rows: list[list[str]] = []
    max_column = 0
    for row in sheet.iter_rows():
        rendered = ["" if cell.value is None else _collapse_whitespace(str(cell.value)) for cell in row]
        if any(rendered):
            rows.append(rendered)
            max_column = max(max_column, len(rendered))
    if not rows:
        return [], f"{sheet.title}!A1"
    end_ref = f"{get_column_letter(max_column)}{len(rows)}"
    return rows, f"{sheet.title}!A1:{end_ref}"


def _extract_xls_rows(sheet: Any) -> tuple[list[list[str]], str]:
    rows: list[list[str]] = []
    max_column = 0
    for row_index in range(sheet.nrows):
        rendered = [
            _collapse_whitespace(str(sheet.cell_value(row_index, column_index)))
            for column_index in range(sheet.ncols)
        ]
        if any(rendered):
            rows.append(rendered)
            max_column = max(max_column, len(rendered))
    if not rows:
        return [], f"{sheet.name}!A1"
    end_ref = f"{get_column_letter(max_column)}{len(rows)}"
    return rows, f"{sheet.name}!A1:{end_ref}"


class DocumentTooling:
    """Parse uploaded files into the demo's richer document contract."""

    def __init__(
        self,
        *,
        root: Path,
        describe_access: Callable[[Path], Any],
    ) -> None:
        self.root = root
        self.describe_access = describe_access

    def parse_document(self, file_path: Path) -> ParsedDocument:
        relative_path = file_path.relative_to(self.root).as_posix()
        suffix = file_path.suffix.lower()
        access = self.describe_access(file_path)
        if suffix in IMAGE_EXTENSIONS:
            return self._parse_image_document(file_path=file_path, path=relative_path)
        if suffix == ".pdf":
            return self._parse_pdf_document(file_path=file_path, path=relative_path)
        if suffix == ".pptx":
            return self._parse_pptx_document(file_path=file_path, path=relative_path)
        if suffix == ".docx":
            return self._parse_docx_document(file_path=file_path, path=relative_path)
        if suffix == ".xlsx":
            return self._parse_xlsx_document(file_path=file_path, path=relative_path)
        if suffix == ".xls":
            return self._parse_xls_document(file_path=file_path, path=relative_path)
        if suffix in LEGACY_OFFICE_EXTENSIONS:
            return self._parse_legacy_document(file_path=file_path, path=relative_path)
        if access.text_readable:
            return self._parse_text_document(file_path=file_path, path=relative_path)
        raise ValueError(
            f"document tools do not support '{relative_path}' ({access.mime_type})"
        )

    def describe_document(self, file_path: Path) -> dict[str, Any]:
        """Return lightweight document metadata for browse/list surfaces.

        `document_list` should be able to enumerate the MCP-owned knowledge tree
        without forcing the agent to guess whether a file is searchable. Keep
        unsupported files explicit instead of silently hiding them.
        """

        relative_path = file_path.relative_to(self.root).as_posix()
        access = self.describe_access(file_path)
        try:
            document = self.parse_document(file_path)
        except ValueError:
            return {
                "path": relative_path,
                "document_kind": None,
                "locator_type": None,
                "contains_visual": False,
                "supported": False,
                "mime_type": access.mime_type,
            }
        return {
            "path": document.path,
            "document_kind": document.document_kind,
            "locator_type": document.locator_type,
            "contains_visual": document.contains_visual,
            "supported": True,
            "mime_type": access.mime_type,
        }

    def search(
        self,
        *,
        files: list[Path],
        query: str,
        cursor: int,
        limit: int,
    ) -> dict[str, Any]:
        if not query.strip():
            raise ValueError("query is required")

        terms = _extract_search_terms(query)
        matches: list[dict[str, Any]] = []
        skipped_files: list[str] = []
        for file_path in files:
            try:
                document = self.parse_document(file_path)
            except ValueError:
                skipped_files.append(file_path.relative_to(self.root).as_posix())
                continue

            for unit_index, unit in enumerate(document.units):
                best_match: dict[str, Any] | None = None
                for evidence_type, evidence_text in unit.search_entries:
                    matched_terms, match_index = _match_terms(
                        terms=terms,
                        haystack=evidence_text,
                    )
                    if not matched_terms:
                        continue
                    candidate = {
                        "path": document.path,
                        "document_kind": document.document_kind,
                        "locator": unit.locator,
                        "locator_type": unit.locator_type,
                        "snippet": _build_snippet(
                            text=evidence_text,
                            match_index=match_index,
                        ),
                        "score": _score_match(
                            matched_terms=matched_terms,
                            match_index=match_index,
                        ),
                        "evidence_type": evidence_type,
                        "contains_visual": unit.contains_visual,
                        "next_action_hint": _next_action_hint(
                            unit_index=unit_index,
                            total_units=len(document.units),
                            contains_visual=unit.contains_visual,
                            evidence_type=evidence_type,
                        ),
                    }
                    if best_match is None or float(candidate["score"]) > float(best_match["score"]):
                        best_match = candidate
                if best_match is not None:
                    matches.append(best_match)

        matches.sort(
            key=lambda item: (
                -float(item["score"]),
                item["path"],
                str(item["locator"]),
            )
        )
        safe_cursor = max(cursor, 0)
        safe_limit = min(max(limit, 1), 50)
        next_cursor = safe_cursor + safe_limit
        return {
            "query": query,
            "results": matches[safe_cursor:next_cursor],
            "cursor": safe_cursor,
            "limit": safe_limit,
            "total": len(matches),
            "has_more": next_cursor < len(matches),
            "next_cursor": next_cursor if next_cursor < len(matches) else None,
            "skipped_files": skipped_files,
        }

    def read(self, *, file_path: Path, cursor: int, limit: int) -> dict[str, Any]:
        document = self.parse_document(file_path)
        safe_cursor = max(cursor, 0)
        safe_limit = min(max(limit, 1), 50)
        total_units = len(document.units)
        if total_units == 0:
            return {
                "path": document.path,
                "document_kind": document.document_kind,
                "locator_type": document.locator_type,
                "cursor": safe_cursor,
                "limit": safe_limit,
                "has_more": False,
                "next_cursor": None,
                "total_units": 0,
                "returned_units": 0,
                "contains_visual": document.contains_visual,
                "content_blocks": [],
            }

        selected_units = document.units[safe_cursor : safe_cursor + safe_limit]
        content_blocks: list[dict[str, Any]] = []
        for unit in selected_units:
            content_blocks.extend(unit.content_blocks)

        next_cursor = safe_cursor + len(selected_units)
        return {
            "path": document.path,
            "document_kind": document.document_kind,
            "locator_type": document.locator_type,
            "cursor": safe_cursor,
            "limit": safe_limit,
            "has_more": next_cursor < total_units,
            "next_cursor": next_cursor if next_cursor < total_units else None,
            "total_units": total_units,
            "returned_units": len(selected_units),
            "contains_visual": any(unit.contains_visual for unit in selected_units),
            "content_blocks": content_blocks,
        }

    def fetch_asset(self, *, file_path: Path, asset_ref: str) -> dict[str, Any]:
        if not asset_ref.strip():
            raise ValueError("asset_ref is required")
        document = self.parse_document(file_path)
        asset = document.assets.get(asset_ref)
        if asset is None:
            raise FileNotFoundError(
                f"asset_ref '{asset_ref}' does not exist for {document.path}"
            )
        return asset.fetch_payload(path=document.path)

    def _parse_text_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        units: list[DocumentUnit] = []
        if not lines:
            units.append(
                DocumentUnit(
                    locator=1,
                    locator_type="line",
                    content_blocks=[
                        {
                            "type": "text",
                            "locator": 1,
                            "text": "",
                        }
                    ],
                    search_entries=[],
                    contains_visual=False,
                    preview_text="",
                )
            )
        for line_number, line in enumerate(lines, start=1):
            units.append(
                DocumentUnit(
                    locator=line_number,
                    locator_type="line",
                    content_blocks=[
                        {
                            "type": "text",
                            "locator": line_number,
                            "text": line,
                        }
                    ],
                    search_entries=[("text", line)] if line.strip() else [],
                    contains_visual=False,
                    preview_text=line,
                )
            )
        return ParsedDocument(
            path=path,
            document_kind="text",
            locator_type="line",
            units=units,
            assets={},
            contains_visual=False,
        )

    def _parse_image_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        asset = _asset_from_path(asset_ref="page:1:image:1", file_path=file_path)
        summary = f"Image file {file_path.name} ({asset.width or '?'}x{asset.height or '?'})"
        unit = DocumentUnit(
            locator=1,
            locator_type="page",
            content_blocks=[
                asset.read_block(locator=1),
                {
                    "type": "document",
                    "locator": 1,
                    "summary": summary,
                },
            ],
            search_entries=[("vision_summary", f"{file_path.stem} {summary}")],
            contains_visual=True,
            preview_text=summary,
        )
        return ParsedDocument(
            path=path,
            document_kind="image",
            locator_type="page",
            units=[unit],
            assets={asset.asset_ref: asset},
            contains_visual=True,
        )

    def _parse_pdf_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        reader = PdfReader(str(file_path))
        units: list[DocumentUnit] = []
        assets: dict[str, DocumentAsset] = {}
        for page_index, page in enumerate(reader.pages, start=1):
            text = _collapse_whitespace(page.extract_text() or "")
            content_blocks: list[dict[str, Any]] = []
            search_entries: list[tuple[EvidenceType, str]] = []
            asset_refs: list[str] = []

            if text:
                content_blocks.append(
                    {
                        "type": "text",
                        "locator": page_index,
                        "text": text,
                    }
                )
                search_entries.append(("text", text))

            for image_index, image_file in enumerate(page.images, start=1):
                asset_ref = f"page:{page_index}:image:{image_index}"
                asset = _asset_from_bytes(
                    asset_ref=asset_ref,
                    data=image_file.data,
                    file_name=image_file.name,
                    summary=f"Embedded image on page {page_index}",
                    extra={"page": page_index, "source": "pdf"},
                )
                assets[asset_ref] = asset
                asset_refs.append(asset_ref)
                content_blocks.append(asset.read_block(locator=page_index))

            if asset_refs and not text:
                search_entries.append(
                    (
                        "vision_summary",
                        f"Page {page_index} contains {len(asset_refs)} embedded images",
                    )
                )

            if not content_blocks:
                content_blocks.append(
                    {
                        "type": "document",
                        "locator": page_index,
                        "summary": "No extractable text or image assets on this page.",
                    }
                )

            units.append(
                DocumentUnit(
                    locator=page_index,
                    locator_type="page",
                    content_blocks=content_blocks,
                    search_entries=search_entries,
                    contains_visual=bool(asset_refs),
                    preview_text=text or f"Page {page_index}",
                )
            )

        return ParsedDocument(
            path=path,
            document_kind="pdf",
            locator_type="page",
            units=units,
            assets=assets,
            contains_visual=bool(assets),
        )

    def _parse_pptx_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        presentation = Presentation(str(file_path))
        units: list[DocumentUnit] = []
        assets: dict[str, DocumentAsset] = {}
        for slide_index, slide in enumerate(presentation.slides, start=1):
            text_blocks: list[str] = []
            search_entries: list[tuple[EvidenceType, str]] = []
            content_blocks: list[dict[str, Any]] = []
            contains_visual = False

            for shape_index, shape in enumerate(slide.shapes, start=1):
                if getattr(shape, "has_text_frame", False):
                    text = _collapse_whitespace(getattr(shape, "text", ""))
                    if text:
                        text_blocks.append(text)

                if getattr(shape, "has_table", False):
                    rows = [
                        [_collapse_whitespace(cell.text) for cell in row.cells]
                        for row in shape.table.rows
                    ]
                    region = f"slide:{slide_index}:table:{shape_index}"
                    table_text = _table_rows_to_text(rows)
                    if table_text:
                        search_entries.append(("table_text", table_text))
                    content_blocks.append(
                        {
                            "type": "table",
                            "locator": slide_index,
                            "region": region,
                            "rows": rows,
                            "text": table_text,
                        }
                    )

                if getattr(shape, "has_chart", False):
                    contains_visual = True
                    chart = shape.chart
                    summary = _chart_summary_text(
                        getattr(chart, "chart_title", None),
                        f"Chart on slide {slide_index}",
                    )
                    series_names = [
                        _collapse_whitespace(str(getattr(series, "name", "")))
                        for series in getattr(chart, "series", [])
                        if _collapse_whitespace(str(getattr(series, "name", "")))
                    ]
                    full_summary = "; ".join(
                        part
                        for part in [summary, ", ".join(series_names) if series_names else ""]
                        if part
                    )
                    if full_summary:
                        search_entries.append(("vision_summary", full_summary))
                        content_blocks.append(
                            {
                                "type": "document",
                                "locator": slide_index,
                                "summary": full_summary,
                                "kind": "chart",
                            }
                        )

                image = getattr(shape, "image", None)
                if image is not None:
                    contains_visual = True
                    asset_ref = f"slide:{slide_index}:image:{shape_index}"
                    asset = _asset_from_bytes(
                        asset_ref=asset_ref,
                        data=image.blob,
                        file_name=f"{shape.name}.{image.ext}",
                        summary=f"Slide {slide_index} image {shape_index}",
                        extra={"slide": slide_index, "shape": shape.name, "source": "pptx"},
                    )
                    assets[asset_ref] = asset
                    content_blocks.append(asset.read_block(locator=slide_index))

            slide_text = "\n".join(text_blocks).strip()
            if slide_text:
                content_blocks.insert(
                    0,
                    {
                        "type": "text",
                        "locator": slide_index,
                        "text": slide_text,
                    },
                )
                search_entries.insert(0, ("text", slide_text))
            if not content_blocks:
                content_blocks.append(
                    {
                        "type": "document",
                        "locator": slide_index,
                        "summary": f"Slide {slide_index} has no extractable text.",
                    }
                )
            units.append(
                DocumentUnit(
                    locator=slide_index,
                    locator_type="slide",
                    content_blocks=content_blocks,
                    search_entries=search_entries,
                    contains_visual=contains_visual,
                    preview_text=slide_text or f"Slide {slide_index}",
                )
            )

        return ParsedDocument(
            path=path,
            document_kind="pptx",
            locator_type="slide",
            units=units,
            assets=assets,
            contains_visual=any(unit.contains_visual for unit in units),
        )

    def _parse_docx_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        document = WordDocument(str(file_path))
        units: list[DocumentUnit] = []
        assets, asset_refs = _extract_docx_assets(document)

        for index, block in enumerate(_iter_docx_blocks(document), start=1):
            if isinstance(block, Paragraph):
                text = _collapse_whitespace(block.text)
                content_blocks = [
                    {
                        "type": "text",
                        "locator": index,
                        "text": text,
                    }
                ] if text else [
                    {
                        "type": "document",
                        "locator": index,
                        "summary": f"Region {index} has no visible text.",
                    }
                ]
                units.append(
                    DocumentUnit(
                        locator=index,
                        locator_type="region",
                        content_blocks=content_blocks,
                        search_entries=[("text", text)] if text else [],
                        contains_visual=False,
                        preview_text=text,
                    )
                )
                continue

            rows = [
                [_collapse_whitespace(cell.text) for cell in row.cells]
                for row in block.rows
            ]
            table_text = _table_rows_to_text(rows)
            units.append(
                DocumentUnit(
                    locator=index,
                    locator_type="region",
                    content_blocks=[
                        {
                            "type": "table",
                            "locator": index,
                            "region": f"table:{index}",
                            "rows": rows,
                            "text": table_text,
                        }
                    ],
                    search_entries=[("table_text", table_text)] if table_text else [],
                    contains_visual=False,
                    preview_text=table_text,
                )
            )

        if asset_refs:
            media_locator = len(units) + 1
            media_blocks = [assets[asset_ref].read_block(locator=media_locator) for asset_ref in asset_refs]
            units.append(
                DocumentUnit(
                    locator=media_locator,
                    locator_type="region",
                    content_blocks=media_blocks,
                    search_entries=[
                        (
                            "vision_summary",
                            f"Document contains {len(asset_refs)} embedded images",
                        )
                    ],
                    contains_visual=True,
                    preview_text=f"{len(asset_refs)} embedded images",
                )
            )

        if not units:
            units.append(
                DocumentUnit(
                    locator=1,
                    locator_type="region",
                    content_blocks=[
                        {
                            "type": "document",
                            "locator": 1,
                            "summary": "Document has no extractable content.",
                        }
                    ],
                    search_entries=[],
                    contains_visual=bool(asset_refs),
                    preview_text="",
                )
            )

        return ParsedDocument(
            path=path,
            document_kind="docx",
            locator_type="region",
            units=units,
            assets=assets,
            contains_visual=bool(asset_refs),
        )

    def _parse_xlsx_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        workbook = load_workbook(str(file_path), data_only=True)
        try:
            units: list[DocumentUnit] = []
            assets: dict[str, DocumentAsset] = {}
            for sheet in workbook.worksheets:
                rows, region = _extract_sheet_rows(sheet)
                table_text = _table_rows_to_text(rows)
                search_entries: list[tuple[EvidenceType, str]] = []
                content_blocks: list[dict[str, Any]] = []
                contains_visual = False

                if rows:
                    content_blocks.append(
                        {
                            "type": "table",
                            "locator": sheet.title,
                            "region": region,
                            "sheet_name": sheet.title,
                            "rows": rows,
                            "text": table_text,
                        }
                    )
                    search_entries.append(("table_text", table_text))

                for chart_index, chart in enumerate(getattr(sheet, "_charts", []), start=1):
                    contains_visual = True
                    summary = _chart_summary_text(
                        getattr(chart, "title", None),
                        f"Chart {chart_index} on sheet {sheet.title}",
                    )
                    search_entries.append(("vision_summary", summary))
                    content_blocks.append(
                        {
                            "type": "document",
                            "locator": sheet.title,
                            "summary": summary,
                            "kind": "chart",
                        }
                    )

                for image_index, image in enumerate(getattr(sheet, "_images", []), start=1):
                    contains_visual = True
                    asset_ref = f"sheet:{sheet.title}:image:{image_index}"
                    assets[asset_ref] = _asset_from_bytes(
                        asset_ref=asset_ref,
                        data=image._data(),
                        file_name=f"{sheet.title}-image-{image_index}.{image.format}",
                        summary=f"Image {image_index} on sheet {sheet.title}",
                        extra={"sheet": sheet.title, "source": "xlsx"},
                    )
                    content_blocks.append(
                        assets[asset_ref].read_block(locator=sheet.title)
                    )

                if not content_blocks:
                    content_blocks.append(
                        {
                            "type": "document",
                            "locator": sheet.title,
                            "summary": f"Sheet {sheet.title} has no extractable content.",
                        }
                    )

                units.append(
                    DocumentUnit(
                        locator=sheet.title,
                        locator_type="sheet",
                        content_blocks=content_blocks,
                        search_entries=search_entries,
                        contains_visual=contains_visual,
                        preview_text=table_text or sheet.title,
                    )
                )
        finally:
            workbook.close()

        return ParsedDocument(
            path=path,
            document_kind="xlsx",
            locator_type="sheet",
            units=units,
            assets=assets,
            contains_visual=any(unit.contains_visual for unit in units),
        )

    def _parse_xls_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        workbook = open_xls_workbook(str(file_path))
        units: list[DocumentUnit] = []
        for sheet in workbook.sheets():
            rows, region = _extract_xls_rows(sheet)
            table_text = _table_rows_to_text(rows)
            content_blocks = [
                {
                    "type": "table",
                    "locator": sheet.name,
                    "region": region,
                    "sheet_name": sheet.name,
                    "rows": rows,
                    "text": table_text,
                }
            ] if rows else [
                {
                    "type": "document",
                    "locator": sheet.name,
                    "summary": f"Sheet {sheet.name} has no extractable content.",
                }
            ]
            units.append(
                DocumentUnit(
                    locator=sheet.name,
                    locator_type="sheet",
                    content_blocks=content_blocks,
                    search_entries=[("table_text", table_text)] if table_text else [],
                    contains_visual=False,
                    preview_text=table_text or sheet.name,
                )
            )
        return ParsedDocument(
            path=path,
            document_kind="xls",
            locator_type="sheet",
            units=units,
            assets={},
            contains_visual=False,
        )

    def _parse_legacy_document(self, *, file_path: Path, path: str) -> ParsedDocument:
        kind = LEGACY_OFFICE_EXTENSIONS[file_path.suffix.lower()]
        summary = (
            "Legacy Office binary format. The 8084 demo keeps the document "
            "contract available, but only file-name level search is indexed for "
            "this format because no OLE parser is bundled in the demo image."
        )
        return ParsedDocument(
            path=path,
            document_kind=kind,
            locator_type="region",
            units=[
                DocumentUnit(
                    locator=1,
                    locator_type="region",
                    content_blocks=[
                        {
                            "type": "document",
                            "locator": 1,
                            "summary": summary,
                        }
                    ],
                    search_entries=[("vision_summary", f"{file_path.stem} {summary}")],
                    contains_visual=False,
                    preview_text=summary,
                )
            ],
            assets={},
            contains_visual=False,
        )
