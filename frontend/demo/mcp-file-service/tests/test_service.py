from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from docx import Document as WordDocument
from docx.shared import Inches as DocInches
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.drawing.image import Image as XlsxImage
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches as PptxInches


SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.service import FileMcpService


def build_pdf_bytes(pages: list[str]) -> bytes:
    """Generate a minimal text PDF that pypdf can extract in tests."""

    header = b"%PDF-1.4\n"
    objects: list[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    ]
    page_refs: list[str] = []
    page_objects: list[bytes] = []
    next_object_number = 3
    font_object_number = 2 * len(pages) + 3

    for text in pages:
        page_number = next_object_number
        content_number = next_object_number + 1
        page_refs.append(f"{page_number} 0 R")
        safe_text = (
            text.replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )
        stream = (
            f"BT\n/F1 18 Tf\n72 720 Td\n({safe_text}) Tj\nET\n".encode("latin-1")
        )
        page_objects.append(
            (
                f"{page_number} 0 obj\n"
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 {font_object_number} 0 R >> >> "
                f"/Contents {content_number} 0 R >>\nendobj\n"
            ).encode("latin-1")
        )
        page_objects.append(
            (
                f"{content_number} 0 obj\n<< /Length {len(stream)} >>\nstream\n"
            ).encode("latin-1")
            + stream
            + b"endstream\nendobj\n"
        )
        next_object_number += 2

    objects.append(
        (
            f"2 0 obj\n<< /Type /Pages /Kids [{' '.join(page_refs)}] "
            f"/Count {len(page_refs)} >>\nendobj\n"
        ).encode("latin-1")
    )
    objects.extend(page_objects)
    objects.append(
        (
            f"{font_object_number} 0 obj\n"
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
            "/Encoding /WinAnsiEncoding >>\nendobj\n"
        ).encode("latin-1")
    )

    offsets = [0]
    body = b""
    for obj in objects:
        offsets.append(len(header) + len(body))
        body += obj

    startxref = len(header) + len(body)
    xref_parts = [
        f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("latin-1")
    ]
    for offset in offsets[1:]:
        xref_parts.append(f"{offset:010d} 00000 n \n".encode("latin-1"))

    trailer = (
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
        f"startxref\n{startxref}\n%%EOF\n"
    ).encode("latin-1")
    return header + body + b"".join(xref_parts) + trailer


class FileMcpServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        cases_dir = self.root / "案例大全"
        cases_dir.mkdir(parents=True, exist_ok=True)
        (cases_dir / "a.md").write_text(
            "灾祸 会来\n好运 也会来\n官非 风险\n",
            encoding="utf-8",
        )
        (cases_dir / "b.md").write_text(
            "血光 之灾\n顺遂 发展\n",
            encoding="utf-8",
        )
        self.service = FileMcpService(self.root, ocr_languages=("eng",))

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write_image(self, relative_path: str, *, text: str | None = None) -> Path:
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new("RGB", (1200, 320), "white")
        if text:
            draw = ImageDraw.Draw(image)
            font_path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
            if font_path.exists():
                font = ImageFont.truetype(str(font_path), 96)
            else:
                font = ImageFont.load_default()
            draw.text((60, 90), text, fill="black", font=font)
        image.save(target)
        return target

    def _write_scanned_pdf(self, relative_path: str, *, text: str) -> Path:
        image_path = self._write_image("assets/scanned-page.png", text=text)
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(image_path) as image:
            image.convert("RGB").save(target, "PDF", resolution=150)
        return target

    def _write_pdf(self, relative_path: str, pages: list[str]) -> Path:
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(build_pdf_bytes(pages))
        return target

    def _write_pptx(self, relative_path: str) -> Path:
        image_path = self._write_image("assets/slide-proof.png")
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        slide.shapes.title.text = "Quarterly Revenue"
        slide.shapes.add_picture(
            str(image_path),
            PptxInches(0.8),
            PptxInches(1.2),
            width=PptxInches(1.8),
        )
        chart_data = CategoryChartData()
        chart_data.categories = ["Q1", "Q2"]
        chart_data.add_series("Revenue", (120, 180))
        chart = slide.shapes.add_chart(
            XL_CHART_TYPE.COLUMN_CLUSTERED,
            PptxInches(3.0),
            PptxInches(1.2),
            PptxInches(4.5),
            PptxInches(3.2),
            chart_data,
        ).chart
        chart.has_title = True
        chart.chart_title.text_frame.text = "Revenue Trend"
        presentation.save(target)
        return target

    def _write_pptx_with_ocr_image(self, relative_path: str, *, text: str) -> Path:
        image_path = self._write_image("assets/slide-ocr.png", text=text)
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_picture(
            str(image_path),
            PptxInches(0.8),
            PptxInches(0.8),
            width=PptxInches(8.0),
        )
        presentation.save(target)
        return target

    def _write_docx(self, relative_path: str) -> Path:
        image_path = self._write_image("assets/doc-proof.png")
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        document = WordDocument()
        document.add_paragraph("Customer premium note")
        document.add_picture(str(image_path), width=DocInches(1))
        document.save(target)
        return target

    def _write_xlsx(self, relative_path: str) -> Path:
        image_path = self._write_image("assets/sheet-proof.png")
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Revenue"
        sheet.append(["Quarter", "Revenue"])
        sheet.append(["Q1", 120])
        sheet.append(["Q2", 180])
        sheet.add_image(XlsxImage(str(image_path)), "D2")
        chart = BarChart()
        chart.title = "Revenue Trend"
        data = Reference(sheet, min_col=2, min_row=1, max_row=3)
        categories = Reference(sheet, min_col=1, min_row=2, max_row=3)
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(categories)
        sheet.add_chart(chart, "F2")
        workbook.save(target)
        workbook.close()
        return target

    def test_list_reports_binary_documents_without_hiding_sibling_text_files(self) -> None:
        (self.root / "合同.pdf").write_bytes(b"%PDF-1.4 fake")
        (self.root / "合同.md").write_text(
            "# 合同\n\n赔付条款\n",
            encoding="utf-8",
        )

        payload = self.service.list_files_payload(limit=20)
        items_by_path = {item["path"]: item for item in payload["items"]}

        self.assertIn("合同.pdf", items_by_path)
        self.assertIn("合同.md", items_by_path)
        self.assertEqual(items_by_path["合同.pdf"]["content_kind"], "binary_document")
        self.assertFalse(items_by_path["合同.pdf"]["text_readable"])
        self.assertEqual(items_by_path["合同.md"]["content_kind"], "text")
        self.assertTrue(items_by_path["合同.md"]["text_readable"])

    def test_workspace_virtual_root_alias_resolves_to_uploaded_root(self) -> None:
        payload = self.service.ls_payload(path="/mnt/user-data/workspace", limit=20)
        listed_paths = {item["path"] for item in payload["items"]}

        self.assertIn("案例大全", listed_paths)
        self.assertEqual(payload["total"], 1)

    def test_document_list_exposes_directories_and_document_metadata(self) -> None:
        self._write_pdf(
            "nested/contracts/policy-alpha.pdf",
            ["Deductible is 500 USD"],
        )

        root_payload = self.service.document_list_payload(limit=20)
        root_rows = {item["path"]: item for item in root_payload["items"]}
        self.assertIn("nested", root_rows)
        self.assertEqual(root_rows["nested"]["entry_type"], "directory")
        self.assertTrue(root_rows["nested"]["has_children"])
        self.assertTrue(root_payload["complete_tree"])
        self.assertIn("nested/contracts/policy-alpha.pdf", root_payload["document_paths"])
        self.assertIn("nested/", root_payload["tree"])
        self.assertIn("  contracts/", root_payload["tree"])
        self.assertIn("    policy-alpha.pdf [pdf]", root_payload["tree"])

        nested_payload = self.service.document_list_payload(path="nested/contracts", limit=20)
        file_row = nested_payload["items"][0]
        self.assertEqual(file_row["path"], "nested/contracts/policy-alpha.pdf")
        self.assertEqual(file_row["document_kind"], "pdf")
        self.assertEqual(file_row["locator_type"], "page")
        self.assertFalse(file_row["contains_visual"])
        self.assertTrue(file_row["supported"])

    def test_document_list_keeps_large_trees_paginated(self) -> None:
        for index in range(351):
            target = self.root / "bulk" / f"doc-{index:03d}.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f"# Doc {index}\n", encoding="utf-8")

        payload = self.service.document_list_payload(limit=500)

        self.assertFalse(payload["complete_tree"])
        self.assertEqual(payload["complete_tree_limit"], 350)
        self.assertGreaterEqual(payload["document_total"], 351)
        self.assertNotIn("document_paths", payload)
        self.assertNotIn("tree", payload)

    def test_read_rejects_binary_documents_instead_of_converting_them(self) -> None:
        (self.root / "合同.pdf").write_bytes(b"%PDF-1.4 fake")

        with self.assertRaisesRegex(
            ValueError,
            "fs_read only supports text files.*document_\\* MCP tools",
        ):
            self.service.read_file_payload(file_path="合同.pdf", offset=0, limit=10)

    def test_preview_explains_binary_documents_without_fake_text_content(self) -> None:
        (self.root / "合同.pdf").write_bytes(b"%PDF-1.4 fake")

        payload = self.service.preview_file_payload(path="合同.pdf")

        self.assertEqual(payload["content_kind"], "binary_document")
        self.assertFalse(payload["text_readable"])
        self.assertIn("document_list(path?, cursor?, limit?)", payload["content"])

    def test_grep_skips_binary_documents_in_directory_scope(self) -> None:
        (self.root / "合同.pdf").write_bytes(b"%PDF-1.4 fake")

        payload = self.service.grep_payload(pattern="赔付", path="", glob="*.pdf", limit=20)

        self.assertEqual(payload["total"], 0)
        self.assertEqual(payload["skipped_binary_files"], 1)

    def test_grep_rejects_binary_document_file_scope(self) -> None:
        (self.root / "合同.pdf").write_bytes(b"%PDF-1.4 fake")

        with self.assertRaisesRegex(
            ValueError,
            "fs_grep only supports text files.*document_\\* MCP tools",
        ):
            self.service.grep_payload(pattern="赔付", path="合同.pdf", limit=20)

    def test_delete_file_only_removes_requested_path(self) -> None:
        original = self.root / "合同.pdf"
        companion = self.root / "合同.md"
        original.write_bytes(b"%PDF-1.4 fake")
        companion.write_text("# 合同\n", encoding="utf-8")

        self.service.delete_file("合同.pdf")

        self.assertFalse(original.exists())
        self.assertTrue(companion.exists())

    def test_grep_accepts_count_output_mode(self) -> None:
        payload = self.service.grep_payload(
            pattern="灾祸|血光|官非",
            path="/mnt/user-data/uploads/案例大全",
            glob="*.md",
            output_mode="count",
            limit=20,
        )

        self.assertEqual(payload["output_mode"], "count")
        self.assertEqual(payload["requested_output_mode"], "count")
        self.assertEqual(payload["total_matches"], 3)
        self.assertEqual(
            payload["items"],
            [
                {"path": "案例大全/a.md", "match_count": 2},
                {"path": "案例大全/b.md", "match_count": 1},
            ],
        )

    def test_grep_treats_regex_alternation_as_matches(self) -> None:
        payload = self.service.grep_payload(
            pattern="灾祸|血光|官非",
            path="/mnt/user-data/uploads/案例大全",
            glob="*.md",
            output_mode="content",
            limit=20,
        )

        self.assertEqual(payload["output_mode"], "content")
        self.assertEqual(payload["total"], 3)
        self.assertEqual(
            [item["path"] for item in payload["items"]],
            ["案例大全/a.md", "案例大全/a.md", "案例大全/b.md"],
        )

    def test_grep_normalizes_file_alias_mode(self) -> None:
        payload = self.service.grep_payload(
            pattern="好运|顺遂",
            path="/mnt/user-data/uploads/案例大全",
            glob="*.md",
            output_mode="files",
            limit=20,
        )

        self.assertEqual(payload["output_mode"], "files_with_matches")
        self.assertEqual(payload["requested_output_mode"], "files")
        self.assertEqual(payload["items"], ["案例大全/a.md", "案例大全/b.md"])

    def test_document_search_greps_pdf_text(self) -> None:
        self._write_pdf(
            "nested/contracts/policy-alpha.pdf",
            ["Deductible is 500 USD", "Coinsurance is 20 percent"],
        )

        payload = self.service.document_search_payload(
            query="Deductible",
            path="nested/contracts/policy-alpha.pdf",
            limit=5,
        )

        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["mode"], "grep")
        self.assertEqual(payload["pattern"], "Deductible")
        match = payload["results"][0]
        self.assertEqual(match["document_kind"], "pdf")
        self.assertEqual(match["locator_type"], "page")
        self.assertEqual(match["locator"], 1)
        self.assertEqual(match["evidence_type"], "text")
        self.assertEqual(match["match_text"], "Deductible")
        self.assertEqual(match["next_action_hint"], "read_more")

    def test_document_search_does_not_decompose_natural_language_questions(self) -> None:
        self._write_pdf(
            "nested/contracts/policy-alpha.pdf",
            ["Deductible is 500 USD", "Coinsurance is 20 percent"],
        )

        payload = self.service.document_search_payload(
            query="What is the deductible in policy alpha?",
            path="nested/contracts/policy-alpha.pdf",
            limit=5,
        )

        self.assertEqual(payload["mode"], "grep")
        self.assertEqual(payload["total"], 0)

    def test_document_read_paginates_pdf_pages(self) -> None:
        self._write_pdf(
            "nested/contracts/policy-alpha.pdf",
            ["Deductible is 500 USD", "Coinsurance is 20 percent"],
        )

        payload = self.service.document_read_payload(
            path="nested/contracts/policy-alpha.pdf",
            cursor=0,
            limit=1,
        )

        self.assertEqual(payload["document_kind"], "pdf")
        self.assertEqual(payload["locator_type"], "page")
        self.assertEqual(payload["total_units"], 2)
        self.assertEqual(payload["returned_units"], 1)
        self.assertTrue(payload["has_more"])
        self.assertEqual(payload["next_cursor"], 1)
        self.assertFalse(payload["contains_visual"])
        self.assertEqual(payload["content_blocks"][0]["type"], "text")

        cache_dir = self.service.cache_root / "nested" / "contracts" / "policy-alpha.pdf"
        self.assertTrue((cache_dir / "manifest.json").exists())
        self.assertTrue((cache_dir / "canonical.md").exists())
        self.assertIn("Deductible is 500 USD", (cache_dir / "canonical.md").read_text(encoding="utf-8"))

    def test_document_search_ocr_hits_scanned_pdf(self) -> None:
        if not self.service.document_tools.ocr_available:
            self.skipTest("tesseract is not available in this test environment")

        self._write_scanned_pdf("nested/scans/claim-scan.pdf", text="CLAIM 42")

        search_payload = self.service.document_search_payload(
            query="claim",
            path="nested/scans/claim-scan.pdf",
            limit=5,
        )
        read_payload = self.service.document_read_payload(
            path="nested/scans/claim-scan.pdf",
            cursor=0,
            limit=1,
        )

        self.assertEqual(search_payload["results"][0]["evidence_type"], "ocr_text")
        self.assertTrue(search_payload["results"][0]["contains_visual"])
        self.assertTrue(read_payload["contains_visual"])
        self.assertTrue(
            any(
                block["type"] == "text" and block.get("text_source") == "ocr"
                for block in read_payload["content_blocks"]
            )
        )
        self.assertTrue(
            any(block["type"] == "image" for block in read_payload["content_blocks"])
        )

        manifest = (
            self.service.cache_root / "nested" / "scans" / "claim-scan.pdf" / "manifest.json"
        ).read_text(encoding="utf-8")
        self.assertIn('"ocr_status": "complete"', manifest)

    def test_document_read_returns_pptx_text_and_visual_blocks(self) -> None:
        self._write_pptx("nested/slides/review-deck.pptx")

        payload = self.service.document_read_payload(
            path="nested/slides/review-deck.pptx",
            cursor=0,
            limit=1,
        )

        self.assertEqual(payload["document_kind"], "pptx")
        self.assertTrue(payload["contains_visual"])
        block_types = {block["type"] for block in payload["content_blocks"]}
        self.assertIn("text", block_types)
        self.assertIn("image", block_types)
        self.assertIn("document", block_types)

        cache_dir = self.service.cache_root / "nested" / "slides" / "review-deck.pptx"
        cached_assets = sorted((cache_dir / "assets").iterdir())
        self.assertTrue(cached_assets)
        self.assertTrue(any(item.name.startswith("slide_1_image_2") for item in cached_assets))

    def test_document_search_ocr_hits_pptx_image_slide(self) -> None:
        if not self.service.document_tools.ocr_available:
            self.skipTest("tesseract is not available in this test environment")

        self._write_pptx_with_ocr_image(
            "nested/slides/ocr-deck.pptx",
            text="LOSS RATIO",
        )

        payload = self.service.document_search_payload(
            query="LOSS",
            path="nested/slides/ocr-deck.pptx",
            limit=5,
        )

        self.assertEqual(payload["results"][0]["document_kind"], "pptx")
        self.assertEqual(payload["results"][0]["evidence_type"], "ocr_text")
        self.assertEqual(payload["results"][0]["next_action_hint"], "fetch_visual")

    def test_prime_document_cache_builds_existing_seed_documents(self) -> None:
        self._write_docx("nested/docs/briefing.docx")
        self._write_xlsx("nested/sheets/revenue-tracker.xlsx")

        self.service.prime_document_cache()

        self.assertTrue((self.service.cache_root / "nested" / "docs" / "briefing.docx" / "manifest.json").exists())
        self.assertTrue((self.service.cache_root / "nested" / "sheets" / "revenue-tracker.xlsx" / "canonical.md").exists())

    def test_document_fetch_asset_inlines_small_pptx_images(self) -> None:
        self._write_pptx("nested/slides/review-deck.pptx")
        read_payload = self.service.document_read_payload(
            path="nested/slides/review-deck.pptx",
            cursor=0,
            limit=1,
        )
        image_block = next(
            block for block in read_payload["content_blocks"] if block["type"] == "image"
        )

        payload = self.service.document_fetch_asset_payload(
            path="nested/slides/review-deck.pptx",
            asset_ref=image_block["asset_ref"],
        )

        self.assertTrue(payload["inlined"])
        self.assertEqual(payload["asset_kind"], "image")
        self.assertIn("content_base64", payload)

    def test_document_search_reads_xlsx_table_and_chart_evidence(self) -> None:
        self._write_xlsx("nested/sheets/revenue-tracker.xlsx")

        table_payload = self.service.document_search_payload(
            query="Q2",
            path="nested/sheets/revenue-tracker.xlsx",
            limit=5,
        )
        chart_payload = self.service.document_search_payload(
            query="Revenue Trend",
            path="nested/sheets/revenue-tracker.xlsx",
            limit=5,
        )

        self.assertEqual(table_payload["results"][0]["evidence_type"], "table_text")
        self.assertEqual(chart_payload["results"][0]["evidence_type"], "vision_summary")
        self.assertEqual(chart_payload["results"][0]["locator_type"], "sheet")

    def test_document_read_returns_xlsx_table_block_and_visual_flag(self) -> None:
        self._write_xlsx("nested/sheets/revenue-tracker.xlsx")

        payload = self.service.document_read_payload(
            path="nested/sheets/revenue-tracker.xlsx",
            cursor=0,
            limit=1,
        )

        self.assertEqual(payload["document_kind"], "xlsx")
        self.assertTrue(payload["contains_visual"])
        self.assertEqual(payload["locator_type"], "sheet")
        self.assertTrue(
            any(block["type"] == "table" for block in payload["content_blocks"])
        )

    def test_document_read_returns_docx_regions_and_media_unit(self) -> None:
        self._write_docx("nested/docs/briefing.docx")

        payload = self.service.document_read_payload(
            path="nested/docs/briefing.docx",
            cursor=0,
            limit=5,
        )

        self.assertEqual(payload["document_kind"], "docx")
        self.assertGreaterEqual(payload["total_units"], 2)
        self.assertTrue(
            any(block["type"] == "image" for block in payload["content_blocks"])
        )

    def test_document_search_ocr_hits_image_file(self) -> None:
        if not self.service.document_tools.ocr_available:
            self.skipTest("tesseract is not available in this test environment")

        self._write_image("nested/images/policy-board.png", text="POLICY LIMIT")

        payload = self.service.document_search_payload(
            query="POLICY",
            path="nested/images/policy-board.png",
            limit=5,
        )

        self.assertEqual(payload["results"][0]["document_kind"], "image")
        self.assertEqual(payload["results"][0]["evidence_type"], "ocr_text")
        read_payload = self.service.document_read_payload(
            path="nested/images/policy-board.png",
            cursor=0,
            limit=1,
        )
        self.assertTrue(read_payload["contains_visual"])
        self.assertTrue(
            any(
                block["type"] == "text" and block.get("text_source") == "ocr"
                for block in read_payload["content_blocks"]
            )
        )


if __name__ == "__main__":
    unittest.main()
