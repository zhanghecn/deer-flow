from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


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
        }
        os.environ["MCP_WORKBENCH_DATA_DIR"] = self.temp_dir.name
        os.environ["MCP_WORKBENCH_PUBLIC_BASE_URL"] = "http://127.0.0.1:8084"
        os.environ.pop("MCP_WORKBENCH_LOCAL_MCP_URL", None)
        os.environ.pop("MCP_WORKBENCH_LOCAL_AGENT_MCP_URL", None)

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

    def test_agent_mcp_endpoint_only_exposes_document_tools(self) -> None:
        tool_names = self._discover_tool_names("/mcp-http-agent/mcp")

        self.assertEqual(
            tool_names,
            {"document_list", "document_search", "document_read", "document_fetch_asset"},
        )

    def test_workbench_mcp_endpoint_matches_agent_document_surface(self) -> None:
        tool_names = self._discover_tool_names("/mcp-http/mcp")

        self.assertEqual(
            tool_names,
            {
                "document_list",
                "document_search",
                "document_read",
                "document_fetch_asset",
            },
        )


if __name__ == "__main__":
    unittest.main()
