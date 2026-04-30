from __future__ import annotations

import base64
import io
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


class WorkbenchMainAppTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self._original_env = {
            "MCP_WORKBENCH_DATA_DIR": os.environ.get("MCP_WORKBENCH_DATA_DIR"),
            "MCP_WORKBENCH_PUBLIC_BASE_URL": os.environ.get("MCP_WORKBENCH_PUBLIC_BASE_URL"),
            "MCP_WORKBENCH_LOCAL_MCP_URL": os.environ.get("MCP_WORKBENCH_LOCAL_MCP_URL"),
            "MCP_WORKBENCH_LOCAL_AGENT_MCP_URL": os.environ.get("MCP_WORKBENCH_LOCAL_AGENT_MCP_URL"),
            "MCP_WORKBENCH_ALLOWED_ORIGINS": os.environ.get("MCP_WORKBENCH_ALLOWED_ORIGINS"),
        }
        os.environ["MCP_WORKBENCH_DATA_DIR"] = self.temp_dir.name
        os.environ["MCP_WORKBENCH_PUBLIC_BASE_URL"] = "http://127.0.0.1:8084"
        os.environ.pop("MCP_WORKBENCH_LOCAL_MCP_URL", None)
        os.environ.pop("MCP_WORKBENCH_LOCAL_AGENT_MCP_URL", None)
        os.environ.pop("MCP_WORKBENCH_ALLOWED_ORIGINS", None)

        import app.main as main_module

        # Reload the module after the env override so the singleton service uses
        # the per-test data directory instead of the container default.
        self.main = importlib.reload(main_module)
        self._client_context = TestClient(self.main.app)
        self.client = self._client_context.__enter__()

    def tearDown(self) -> None:
        self._client_context.__exit__(None, None, None)
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.temp_dir.cleanup()

    def _mcp_request(
        self,
        *,
        path: str,
        method: str,
        request_id: int,
        params: dict[str, object] | None = None,
        session_id: str | None = None,
    ) -> tuple[dict[str, object], str | None]:
        response = self.client.post(
            path,
            headers={
                "content-type": "application/json",
                "accept": self.main.STREAMABLE_HTTP_ACCEPT,
                **({"mcp-session-id": session_id} if session_id else {}),
            },
            json={
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params or {},
            },
        )
        response.raise_for_status()
        payload = self.main._parse_sse_payload(response.text)
        return payload, response.headers.get("mcp-session-id")

    def _discover_tools(self, path: str) -> list[dict[str, object]]:
        initialize_payload, session_id = self._mcp_request(
            path=path,
            method="initialize",
            request_id=1,
            params={
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": self.main.MCP_CLIENT_INFO,
            },
        )
        self.assertIn("result", initialize_payload)
        tools_payload, _ = self._mcp_request(
            path=path,
            method="tools/list",
            request_id=2,
            session_id=session_id,
        )
        result = tools_payload["result"]
        self.assertIsInstance(result, dict)
        tools = result.get("tools")
        self.assertIsInstance(tools, list)
        return [tool for tool in tools if isinstance(tool, dict)]

    def _discover_tool_names(self, path: str) -> set[str]:
        tools = self._discover_tools(path)
        return {
            str(tool.get("name"))
            for tool in tools
            if str(tool.get("name", "")).strip()
        }

    def _call_agent_tool_text(self, name: str, arguments: dict[str, object]) -> str:
        """Call the narrow agent MCP surface and return its first text block."""

        _, session_id = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="initialize",
            request_id=1,
            params={
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": self.main.MCP_CLIENT_INFO,
            },
        )
        call_payload, _ = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="tools/call",
            request_id=2,
            session_id=session_id,
            params={
                "name": name,
                "arguments": arguments,
            },
        )

        result = call_payload["result"]
        self.assertIsInstance(result, dict)
        content = result.get("content")
        self.assertIsInstance(content, list)
        text_block = next(
            item
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
        return str(text_block["text"])

    def test_health_exposes_agent_and_workbench_mcp_urls(self) -> None:
        response = self.client.get(
            "/api/health",
            headers={
                "x-forwarded-proto": "http",
                "x-forwarded-host": "127.0.0.1:8084",
            },
        )
        response.raise_for_status()
        payload = response.json()

        self.assertEqual(payload["mcp_url"], "http://127.0.0.1:8084/mcp-http-agent/mcp")
        self.assertEqual(payload["agent_mcp_url"], "http://127.0.0.1:8084/mcp-http-agent/mcp")
        self.assertEqual(payload["workbench_mcp_url"], "http://127.0.0.1:8084/mcp-http/mcp")
        self.assertTrue(payload["cache_root"].endswith("document-cache"))

    def test_default_cors_allows_lan_browser_origin(self) -> None:
        response = self.client.options(
            "/api/health",
            headers={
                "origin": "http://192.168.0.189:8084",
                "access-control-request-method": "GET",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "*")

    def test_agent_mcp_endpoint_only_exposes_document_tools(self) -> None:
        tool_names = self._discover_tool_names("/mcp-http-agent/mcp")

        self.assertEqual(
            tool_names,
            {"document_list", "document_search", "document_read"},
        )

    def test_workbench_mcp_endpoint_matches_agent_document_surface(self) -> None:
        tool_names = self._discover_tool_names("/mcp-http/mcp")

        self.assertEqual(
            tool_names,
            {
                "document_list",
                "document_search",
                "document_read",
            },
        )

    def test_document_list_mcp_schema_uses_kb_relative_paths_only(self) -> None:
        tools = self._discover_tools("/mcp-http-agent/mcp")
        list_tool = next(
            tool for tool in tools if tool.get("name") == "document_list"
        )

        properties = list_tool["inputSchema"]["properties"]  # type: ignore[index]
        path_schema = properties["path"]  # type: ignore[index]
        path_description = str(path_schema["description"])  # type: ignore[index]

        self.assertIn("Leave empty to list the root", path_description)
        self.assertIn("Do not pass runtime filesystem paths", path_description)

    def test_document_search_mcp_schema_guides_content_search_only(self) -> None:
        tools = self._discover_tools("/mcp-http-agent/mcp")
        search_tool = next(
            tool for tool in tools if tool.get("name") == "document_search"
        )

        description = str(search_tool.get("description") or "")
        self.assertIn("content", description.lower())
        self.assertIn("not file paths", description.lower())
        properties = search_tool["inputSchema"]["properties"]  # type: ignore[index]
        pattern_schema = properties["pattern"]  # type: ignore[index]
        output_mode_schema = properties["output_mode"]  # type: ignore[index]
        self.assertIn("CONTENT only", pattern_schema["description"])  # type: ignore[index]
        self.assertEqual(
            output_mode_schema["enum"],  # type: ignore[index]
            ["content", "files_with_matches", "count"],
        )
        self.assertIn("Do not use 'path'", output_mode_schema["description"])  # type: ignore[index]

    def test_document_list_mcp_returns_plain_final_file_text_for_agents(self) -> None:
        (Path(self.temp_dir.name) / "nested" / "contracts").mkdir(parents=True)
        (Path(self.temp_dir.name) / "nested" / "contracts" / "policy.md").write_text(
            "# Policy\n",
            encoding="utf-8",
        )
        (Path(self.temp_dir.name) / "root.md").write_text("# Root\n", encoding="utf-8")

        _, session_id = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="initialize",
            request_id=1,
            params={
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": self.main.MCP_CLIENT_INFO,
            },
        )
        call_payload, _ = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="tools/call",
            request_id=2,
            session_id=session_id,
            params={
                "name": "document_list",
                "arguments": {},
            },
        )

        result = call_payload["result"]
        self.assertIsInstance(result, dict)
        content = result.get("content")
        self.assertIsInstance(content, list)
        text_block = next(
            item
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
        text = str(text_block["text"])
        lines = text.splitlines()

        self.assertIn("- nested/contracts/policy.md [text]", text)
        self.assertIn("- root.md [text]", text)
        self.assertNotIn("- nested/", lines)
        self.assertNotIn("- nested/contracts/", lines)
        self.assertNotIn('"items"', text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)

    def test_document_list_mcp_unknown_path_returns_no_files_found(self) -> None:
        (Path(self.temp_dir.name) / "root.md").write_text("# Root\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_list",
            {"path": "user-data/uploads"},
        )

        self.assertEqual(text, "No files found")

    def test_document_search_mcp_defaults_to_grep_content_text_for_agents(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "policy.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Deductible is 500 USD\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_search",
            {"pattern": "Deductible"},
        )

        self.assertIn("cases/policy.md:3:Deductible is 500 USD", text)
        self.assertIn("Deductible is 500 USD", text)
        self.assertNotIn('"filenames"', text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)

    def test_document_search_mcp_keeps_files_with_matches_mode(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "policy.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Deductible is 500 USD\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_search",
            {"pattern": "Deductible", "output_mode": "files_with_matches"},
        )

        self.assertIn("Found 1 file", text)
        self.assertIn("cases/policy.md", text)
        self.assertNotIn("Deductible is 500 USD", text)

    def test_document_search_mcp_returns_grep_content_text_for_agents(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "policy.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Header\nDeductible is 500 USD\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_search",
            {"pattern": "Deductible", "output_mode": "content"},
        )

        self.assertIn("cases/policy.md:4:Deductible is 500 USD", text)
        self.assertIn("Deductible is 500 USD", text)
        self.assertNotIn('"matches"', text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)

    def test_document_search_mcp_returns_grep_count_text_for_agents(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "policy.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Deductible one\nDeductible two\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_search",
            {"pattern": "Deductible", "output_mode": "count"},
        )

        self.assertIn("cases/policy.md:2", text)
        self.assertIn("Found 2 total occurrences across 1 file.", text)
        self.assertNotIn('"counts"', text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)

    def test_document_read_mcp_returns_numbered_text_for_agents(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "read.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Alpha\nBeta\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_read",
            {"path": "cases/read.md", "limit": 4},
        )

        self.assertIn("1\t# cases/read.md", text)
        self.assertIn("3\tAlpha", text)
        self.assertIn("4\tBeta", text)
        self.assertNotIn('"content"', text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)

    def test_document_read_mcp_uses_one_based_offset_for_agents(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "offset.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Alpha\nBeta\nGamma\n", encoding="utf-8")

        text = self._call_agent_tool_text(
            "document_read",
            {"path": "cases/offset.md", "offset": 4, "limit": 2},
        )

        self.assertTrue(text.startswith("4\tBeta\n5\tGamma"), text)
        self.assertNotIn("3\tAlpha", text)

    def test_document_read_mcp_adds_image_hint_for_markdown_references(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "vision.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            "Intro\n![Image file bms-vision-red-42.png](images/page_1_image_1.png)\n",
            encoding="utf-8",
        )

        text = self._call_agent_tool_text(
            "document_read",
            {"path": "cases/vision.md", "limit": 5},
        )

        self.assertIn("![Image file bms-vision-red-42.png]", text)
        self.assertIn("<image_read_hint>", text)
        self.assertIn("document_read", text)
        self.assertNotIn('"image_paths"', text)

    def test_document_read_mcp_returns_image_content_blocks(self) -> None:
        image_path = Path(self.temp_dir.name) / "images" / "tiny.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (32, 32), "white").save(image_path)

        _, session_id = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="initialize",
            request_id=1,
            params={
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": self.main.MCP_CLIENT_INFO,
            },
        )
        call_payload, _ = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="tools/call",
            request_id=2,
            session_id=session_id,
            params={
                "name": "document_read",
                "arguments": {"path": "images/tiny.png", "limit": 1},
            },
        )

        result = call_payload["result"]
        self.assertIsInstance(result, dict)
        content = result.get("content")
        self.assertIsInstance(content, list)
        content_types = {item.get("type") for item in content if isinstance(item, dict)}
        self.assertIn("text", content_types)
        self.assertIn("image", content_types)
        text_block = next(
            item
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
        text = str(text_block["text"])
        self.assertIn("1\t![", text)
        self.assertIn("Image asset for images/tiny.png", text)
        self.assertNotIn("<image_read_hint>", text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)
        image_block = next(
            item
            for item in content
            if isinstance(item, dict) and item.get("type") == "image"
        )
        self.assertEqual(image_block["mimeType"], "image/png")
        self.assertTrue(image_block["data"])

    def test_document_read_mcp_downsamples_large_image_blocks(self) -> None:
        image_path = Path(self.temp_dir.name) / "images" / "large.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (2400, 2200), "#1d4ed8").save(image_path)

        _, session_id = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="initialize",
            request_id=1,
            params={
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": self.main.MCP_CLIENT_INFO,
            },
        )
        call_payload, _ = self._mcp_request(
            path="/mcp-http-agent/mcp",
            method="tools/call",
            request_id=2,
            session_id=session_id,
            params={
                "name": "document_read",
                "arguments": {"path": "images/large.png", "limit": 1},
            },
        )

        image_block = next(
            item
            for item in call_payload["result"]["content"]
            if isinstance(item, dict) and item.get("type") == "image"
        )
        image_bytes = base64.b64decode(str(image_block["data"]))
        with Image.open(io.BytesIO(image_bytes)) as image:
            self.assertLessEqual(image.width, 2000)
            self.assertLessEqual(image.height, 2000)

    def test_mcp_content_list_coercion_prefers_json_text_block(self) -> None:
        payload = self.main._coerce_mcp_content_items(
            [
                {"type": "text", "text": "{\"local_parse\":{\"image_root\":\"images\"}}"},
                {"type": "image", "data": "abc", "mimeType": "image/png"},
            ]
        )

        self.assertEqual(payload["local_parse"]["image_root"], "images")

    def test_source_endpoint_serves_uploaded_file_for_clickable_citations(self) -> None:
        target = Path(self.temp_dir.name) / "cases" / "source.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("甲辰 clickable source", encoding="utf-8")

        response = self.client.get("/api/files/source", params={"path": "cases/source.md"})

        response.raise_for_status()
        self.assertEqual(response.text, "甲辰 clickable source")
        self.assertEqual(response.headers["content-type"].split(";")[0], "text/markdown")


if __name__ == "__main__":
    unittest.main()
