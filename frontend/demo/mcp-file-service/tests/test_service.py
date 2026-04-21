from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.service import FileMcpService


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
        self.service = FileMcpService(self.root)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

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


if __name__ == "__main__":
    unittest.main()
