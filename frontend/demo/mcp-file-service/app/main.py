"""ASGI app for the standalone file MCP workbench API and endpoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime
import json
import os
import time
from typing import Annotated, Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from mcp.server.fastmcp import FastMCP
from starlette.concurrency import run_in_threadpool

from .service import build_workbench_service_from_env


HOST = os.getenv("MCP_WORKBENCH_HOST", "0.0.0.0").strip() or "0.0.0.0"
PORT = int(os.getenv("MCP_WORKBENCH_PORT", "8090"))
PUBLIC_BASE_URL = (
    os.getenv("MCP_WORKBENCH_PUBLIC_BASE_URL", "").strip()
    or f"http://127.0.0.1:{PORT}"
)
LOCAL_MCP_URL = os.getenv(
    "MCP_WORKBENCH_LOCAL_MCP_URL",
    f"http://127.0.0.1:{PORT}/mcp-http/mcp",
).strip() or f"http://127.0.0.1:{PORT}/mcp-http/mcp"
MCP_REQUEST_TIMEOUT_SECONDS = float(os.getenv("MCP_WORKBENCH_TIMEOUT_SECONDS", "10"))
STREAMABLE_HTTP_ACCEPT = "application/json, text/event-stream"
MCP_CLIENT_INFO = {
    "name": "openagents-mcp-workbench",
    "version": "0.1.0",
}
ALLOWED_ORIGINS = [
    item.strip()
    for item in os.getenv(
        "MCP_WORKBENCH_ALLOWED_ORIGINS",
        "http://127.0.0.1:8084,http://localhost:8084",
    ).split(",")
    if item.strip()
]

service = build_workbench_service_from_env()

# Keep the MCP transport colocated with the upload API so the workbench can be
# brought up with one container and one stable URL to copy into an agent config.
mcp = FastMCP("file-mcp-workbench", host=HOST, port=PORT)
# `streamable_http_app()` creates the lazily-initialized session manager. When
# FastMCP is mounted under a parent FastAPI app, the sub-app lifespan is not the
# process owner, so we explicitly run the manager from the parent lifespan.
mcp_http_app = mcp.streamable_http_app()


def _translate_error(exc: Exception) -> HTTPException:
    """Map storage validation failures into clear HTTP status codes."""

    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


def _parse_sse_payload(payload: str) -> dict[str, Any]:
    """Extract the JSON-RPC message from FastMCP's SSE envelope."""

    data_lines: list[str] = []
    for raw_line in payload.splitlines():
        if raw_line.startswith("data:"):
            data_lines.append(raw_line.removeprefix("data:").strip())
    if not data_lines:
        raise ValueError("MCP endpoint returned no JSON payload")
    return json.loads("\n".join(data_lines))


def _post_mcp_request(
    *,
    method: str,
    params: dict[str, Any] | None,
    request_id: int,
    session_id: str | None = None,
) -> tuple[dict[str, Any], str | None]:
    """Send one streamable HTTP JSON-RPC request to the colocated MCP app."""

    headers = {
        "content-type": "application/json",
        "accept": STREAMABLE_HTTP_ACCEPT,
    }
    if session_id:
        headers["mcp-session-id"] = session_id

    request_body = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params or {},
    }
    request = urllib_request.Request(
        LOCAL_MCP_URL,
        data=json.dumps(request_body).encode("utf-8"),
        headers=headers,
    )

    try:
        with urllib_request.urlopen(
            request,
            timeout=MCP_REQUEST_TIMEOUT_SECONDS,
        ) as response:
            payload = _parse_sse_payload(response.read().decode("utf-8"))
            return payload, response.headers.get("mcp-session-id") or session_id
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore").strip()
        raise RuntimeError(
            f"MCP request failed with HTTP {exc.code}: {detail or exc.reason}"
        ) from exc


def _initialize_mcp_session() -> tuple[dict[str, Any], str | None]:
    """Start one MCP session with the same handshake used by real clients."""

    return _post_mcp_request(
        method="initialize",
        params={
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": MCP_CLIENT_INFO,
        },
        request_id=1,
    )


def _unwrap_mcp_result(payload: dict[str, Any]) -> dict[str, Any]:
    """Raise protocol errors early so the UI can display one clean message."""

    if "error" in payload:
        error = payload["error"]
        if isinstance(error, dict):
            message = str(error.get("message", "unknown MCP error"))
        else:
            message = str(error)
        raise RuntimeError(message)
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("MCP endpoint returned an invalid result payload")
    return result


def _coerce_json_text(value: Any) -> Any:
    """Decode JSON-shaped text blocks so the workbench can render structured output."""

    if not isinstance(value, str):
        return value
    candidate = value.strip()
    if not candidate:
        return value
    if candidate[0] not in "{[":
        return value
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return value


def _scan_mcp_server() -> dict[str, Any]:
    """Probe the colocated MCP server using the same discovery steps as real clients."""

    started_at = time.perf_counter()
    initialize_payload, session_id = _initialize_mcp_session()
    initialize_result = _unwrap_mcp_result(initialize_payload)

    tools_payload, session_id = _post_mcp_request(
        method="tools/list",
        params={},
        request_id=2,
        session_id=session_id,
    )
    tools_result = _unwrap_mcp_result(tools_payload)
    raw_tools = tools_result.get("tools")
    tools = raw_tools if isinstance(raw_tools, list) else []

    return {
        "reachable": True,
        "transport": "streamable_http",
        "scanned_at": datetime.now(tz=UTC).isoformat(),
        "latency_ms": round((time.perf_counter() - started_at) * 1000, 2),
        "session_id": session_id,
        "protocol_version": initialize_result.get("protocolVersion"),
        "server_info": initialize_result.get("serverInfo"),
        "capabilities": initialize_result.get("capabilities"),
        "tool_count": len(tools),
        "tools": tools,
    }


def _call_mcp_tool(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Execute one tool through the MCP transport instead of calling the service directly."""

    started_at = time.perf_counter()
    _, session_id = _initialize_mcp_session()
    call_payload, session_id = _post_mcp_request(
        method="tools/call",
        params={"name": tool_name, "arguments": arguments},
        request_id=2,
        session_id=session_id,
    )
    call_result = _unwrap_mcp_result(call_payload)
    structured_content = call_result.get("structuredContent")
    result_payload = (
        structured_content.get("result")
        if isinstance(structured_content, dict) and "result" in structured_content
        else None
    )
    normalized_result = _coerce_json_text(result_payload)

    return {
        "tool_name": tool_name,
        "arguments": arguments,
        "transport": "streamable_http",
        "session_id": session_id,
        "latency_ms": round((time.perf_counter() - started_at) * 1000, 2),
        "result": normalized_result if normalized_result is not None else structured_content,
        "raw_result": call_result,
        "executed_at": datetime.now(tz=UTC).isoformat(),
    }


@mcp.tool()
def fs_ls(path: str = "", cursor: int = 0, limit: int = 20) -> str:
    """List files and directories under one relative path."""

    payload = service.ls_payload(path=path, cursor=cursor, limit=limit)
    return service.tool_payload_json(payload)


@mcp.tool()
def fs_read(
    file_path: str, offset: int = 0, limit: int = 2000
) -> str:
    """Read one file window using offset and limit semantics."""

    payload = service.read_file_payload(
        file_path=file_path,
        offset=offset,
        limit=limit,
    )
    return service.tool_payload_json(payload)


@mcp.tool()
def fs_grep(
    pattern: str,
    path: str = "",
    glob: str = "*",
    output_mode: str = "content",
    cursor: int = 0,
    limit: int = 20,
) -> str:
    """Search uploaded files by text or regex-like pattern and optional file glob."""

    payload = service.grep_payload(
        pattern=pattern,
        path=path,
        glob=glob,
        output_mode=output_mode,
        cursor=cursor,
        limit=limit,
    )
    return service.tool_payload_json(payload)


@mcp.tool()
def fs_glob(pattern: str = "*", path: str = "") -> str:
    """Match uploaded files by glob pattern."""

    payload = service.glob_payload(pattern=pattern, path=path)
    return service.tool_payload_json(payload)


@mcp.tool()
def document_search(
    query: str,
    path: str = "",
    cursor: int = 0,
    limit: int = 10,
) -> str:
    """Search uploaded documents by document semantics rather than raw bytes."""

    payload = service.document_search_payload(
        query=query,
        path=path,
        cursor=cursor,
        limit=limit,
    )
    return service.tool_payload_json(payload)


@mcp.tool()
def document_read(path: str, cursor: int = 0, limit: int = 3) -> str:
    """Read one document window using page/slide/sheet/region cursors."""

    payload = service.document_read_payload(
        path=path,
        cursor=cursor,
        limit=limit,
    )
    return service.tool_payload_json(payload)


@mcp.tool()
def document_fetch_asset(path: str, asset_ref: str) -> str:
    """Fetch one visual asset returned by `document_read`."""

    payload = service.document_fetch_asset_payload(
        path=path,
        asset_ref=asset_ref,
    )
    return service.tool_payload_json(payload)


@asynccontextmanager
async def workbench_lifespan(_: FastAPI):
    """Run the mounted FastMCP session manager inside the parent app lifecycle."""

    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title="OpenAgents File MCP Workbench",
    version="0.1.0",
    lifespan=workbench_lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/mcp-http", mcp_http_app)


def _resolve_public_base_url(request: Request) -> str:
    """Prefer the forwarded public host so the copied MCP URL matches nginx."""

    forwarded_proto = request.headers.get("x-forwarded-proto", "").strip()
    forwarded_host = request.headers.get("x-forwarded-host", "").strip()
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"
    return PUBLIC_BASE_URL


@app.get("/api/health")
async def health(request: Request) -> dict[str, Any]:
    """Expose one compact health payload for the acceptance console header."""

    return service.health_payload(base_url=_resolve_public_base_url(request))


@app.get("/api/tool-catalog")
async def tool_catalog() -> dict[str, Any]:
    """Return the MCP tool metadata used by the right-side inspector."""

    return {"tools": service.health_payload(base_url=PUBLIC_BASE_URL)["tool_catalog"]}


@app.post("/api/mcp/scan")
async def scan_mcp() -> dict[str, Any]:
    """Actively probe the mounted MCP endpoint and return discovered tools."""

    try:
        return await run_in_threadpool(_scan_mcp_server)
    except Exception as exc:  # noqa: BLE001 - return probe failure details to the browser
        return {
            "reachable": False,
            "transport": "streamable_http",
            "scanned_at": datetime.now(tz=UTC).isoformat(),
            "latency_ms": None,
            "session_id": None,
            "protocol_version": None,
            "server_info": None,
            "capabilities": None,
            "tool_count": 0,
            "tools": [],
            "error": str(exc),
        }


@app.post("/api/tools/{tool_name}/invoke")
async def invoke_tool(
    tool_name: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    """Execute one MCP tool over streamable HTTP for the browser workbench."""

    try:
        arguments = body.get("arguments", body)
        if not isinstance(arguments, dict):
            raise ValueError("arguments must be a JSON object")
        return await run_in_threadpool(_call_mcp_tool, tool_name, arguments)
    except Exception as exc:  # noqa: BLE001 - convert workbench errors into API details
        raise _translate_error(exc) from exc


@app.get("/api/files")
async def list_uploaded_files(
    path: str = Query(default=""),
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
) -> dict[str, Any]:
    """List uploaded files for the left-hand library panel."""

    try:
        return service.list_files_payload(path=path, cursor=cursor, limit=limit)
    except Exception as exc:  # noqa: BLE001 - convert workbench errors into API details
        raise _translate_error(exc) from exc


@app.get("/api/files/content")
async def read_uploaded_file(
    path: str = Query(...),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=4000, ge=256, le=20000),
) -> dict[str, Any]:
    """Preview uploaded file content without forcing the UI through MCP."""

    try:
        return service.preview_file_payload(path=path, page=page, page_size=page_size)
    except Exception as exc:  # noqa: BLE001 - convert workbench errors into API details
        raise _translate_error(exc) from exc


@app.post("/api/files")
async def upload_files(
    files: Annotated[list[UploadFile], File(...)],
    relative_paths: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Store uploaded files and preserve folder structure when provided by the UI."""

    try:
        parsed_paths = json.loads(relative_paths) if relative_paths else None
        if parsed_paths is not None and not isinstance(parsed_paths, list):
            raise ValueError("relative_paths must be a JSON array when provided")
        return await service.store_uploads(
            files,
            relative_paths=[str(item) for item in parsed_paths] if parsed_paths else None,
        )
    except Exception as exc:  # noqa: BLE001 - convert workbench errors into API details
        raise _translate_error(exc) from exc


@app.delete("/api/files")
async def delete_file(path: str = Query(...)) -> dict[str, Any]:
    """Delete one uploaded file from the mutable workbench dataset."""

    try:
        service.delete_file(path)
        return {"deleted": path}
    except Exception as exc:  # noqa: BLE001 - convert workbench errors into API details
        raise _translate_error(exc) from exc


@app.post("/api/files/reset")
async def reset_files() -> dict[str, Any]:
    """Clear uploaded files and optionally restore the configured seed dataset."""

    try:
        return service.reset_uploaded_files()
    except Exception as exc:  # noqa: BLE001 - convert workbench errors into API details
        raise _translate_error(exc) from exc


def run_mcp_transport(transport: str) -> None:
    """Run the standalone workbench as an MCP server outside the admin API shell."""

    normalized = transport.strip().lower() or "stdio"
    if normalized == "http":
        normalized = "streamable-http"
    if normalized not in {"stdio", "sse", "streamable-http"}:
        raise ValueError(
            "transport must be one of: stdio, sse, streamable-http, http"
        )
    mcp.run(normalized)
