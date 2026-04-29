# OpenAgents MCP Workbench

This directory is a self-contained MCP file workbench for external customer
acceptance testing.

The standalone compose stack has exactly two services:

- `mcp-workbench`: nginx serves the built frontend on `http://127.0.0.1:8084`
  and reverse proxies MCP/API traffic.
- `mcp-file-service`: the internal FastAPI/MCP service on port `8090`.

Runtime data is a visible project bind mount:

- `frontend/demo/deploy/data/files` stores uploaded files.
- `frontend/demo/deploy/data/document-cache` stores parsed document cache
  packages, markdown, metadata, and extracted images.

## Start

The supported demo entrypoint is:

```bash
make demo-start
```

`make demo-start` creates `frontend/demo/deploy/data`, builds the two demo
images, starts the compose stack, and removes old orphaned demo containers from
the previous three-service layout.

Other commands:

```bash
make demo-status
make demo-stop
```

The UI package can also be typechecked and built as a standalone frontend:

```bash
pnpm install --frozen-lockfile
pnpm build
```

The standalone build does not require `frontend/app` or any `@/core` alias from
the main OpenAgents web app.

## Configuration

`make demo-start` uses `frontend/demo/.env.local` when present and otherwise
falls back to the tracked `frontend/demo/.env.defaults`. Vite public values are
baked into the static frontend image during build.

Relevant environment variables:

- `MCP_WORKBENCH_PUBLIC_BASE_URL` defaults to `http://127.0.0.1:8084`.
- `MCP_WORKBENCH_ALLOWED_ORIGINS` defaults to `*`.
- `MCP_WORKBENCH_NETWORK` optionally attaches only `mcp-file-service` to an
  existing OpenAgents network with alias `mcp-file-service` for agent profiles.
- `MCP_WORKBENCH_OCR_LANGUAGES`
- `MCP_WORKBENCH_TESSERACT_BIN`
- `MCP_WORKBENCH_CACHE_DIR`
- `DEMO_NPM_REGISTRY` defaults to `https://registry.npmmirror.com`.
- `DEMO_PYTHON_INDEX_URL` defaults to `https://mirrors.aliyun.com/pypi/simple/`.
- `DEMO_APT_DEBIAN_MIRROR` defaults to `http://mirrors.aliyun.com/debian`.
- `DEMO_APT_SECURITY_MIRROR` defaults to `http://mirrors.aliyun.com/debian-security`.

## MCP Endpoints

The nginx service keeps all browser-visible traffic on `8084`:

- upload and reset APIs under `http://127.0.0.1:8084/api/*`
- agent-facing document MCP at `http://127.0.0.1:8084/mcp-http-agent/mcp`
- workbench-only full MCP at `http://127.0.0.1:8084/mcp-http/mcp`
- manual tool execution at
  `http://127.0.0.1:8084/api/tools/{tool_name}/invoke`

Canonical document tools:

- `document_list(path?)`
- `document_search(pattern, path?, glob?, output_mode?, context?, before?, after?, head_limit?, offset?)`
- `document_read(path, offset?, limit?, locator?)`

PDF / DOCX / PPTX / XLSX stay explicit document types instead of being silently
converted to Markdown companions. Canonicalization stays inside this external
MCP demo and caches normalized packages under `deploy/data/document-cache`.

## Typical Flow

1. Open `http://127.0.0.1:8084`.
2. Drag files or an entire folder into the Explorer panel, or use `上传目录` /
   `上传文件`.
3. Confirm the directory chips keep the first folder segment, for example
   `案例大全 · 4`.
4. Confirm the MCP URL shown by the connection panel.
5. Use the Explorer tree to select a file or folder-like category.
6. Execute `document_list`, `document_search`, or `document_read` and inspect
   arguments, output, and invocation history on the right.
