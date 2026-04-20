"""ASGI app for the standalone file MCP workbench API and endpoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime
import json
import os
from typing import Annotated, Any

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from mcp.server.fastmcp import FastMCP

from .service import build_workbench_service_from_env


HOST = os.getenv("MCP_WORKBENCH_HOST", "0.0.0.0").strip() or "0.0.0.0"
PORT = int(os.getenv("MCP_WORKBENCH_PORT", "8090"))
PUBLIC_BASE_URL = (
    os.getenv("MCP_WORKBENCH_PUBLIC_BASE_URL", "").strip()
    or f"http://127.0.0.1:{PORT}"
)
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
    """Search uploaded files by literal text and optional file glob."""

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


@app.post("/api/tools/{tool_name}/invoke")
async def invoke_tool(
    tool_name: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    """Execute one MCP tool with JSON arguments for the browser workbench."""

    try:
        arguments = body.get("arguments", body)
        if not isinstance(arguments, dict):
            raise ValueError("arguments must be a JSON object")
        result = service.invoke_tool(tool_name, arguments)
        return {
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
            "executed_at": datetime.now(tz=UTC).isoformat(),
        }
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
