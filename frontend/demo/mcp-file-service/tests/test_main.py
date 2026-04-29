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

    def _discover_tool_names(self, path: str) -> set[str]:
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
        return {
            str(tool.get("name"))
            for tool in tools
            if isinstance(tool, dict) and str(tool.get("name", "")).strip()
        }

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
        payload = json.loads(str(text_block["text"]))
        self.assertEqual(payload["local_parse"]["image_root"], "images")
        self.assertTrue(payload["local_parse"]["image_paths"])
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
