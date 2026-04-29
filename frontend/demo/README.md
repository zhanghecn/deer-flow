# OpenAgents MCP Workbench

This directory is a self-contained demo workspace for external customer
acceptance testing.

It contains two surfaces:

- `mcp-workbench-ui` via nginx on `http://127.0.0.1:8084`
- `mcp-file-service` is internal-only and is proxied by nginx

The `8084` workbench uses `react-arborist` to render a VS Code-like file
explorer instead of a flat file list.

The internal file service exposes:

- upload and reset APIs under `http://127.0.0.1:8084/api/*`
- an agent-facing document MCP endpoint at `http://127.0.0.1:8084/mcp-http-agent/mcp`
- a workbench-only full MCP endpoint at `http://127.0.0.1:8084/mcp-http/mcp`
- a manual tool execution endpoint at `http://127.0.0.1:8084/api/tools/{tool_name}/invoke`
- one canonical document tool surface on both MCP endpoints:
  - `document_list(path?, offset?, limit?)`
  - `document_search(pattern, path?, glob?, output_mode?, context?, before?, after?, head_limit?, offset?)`
  - `document_read(path, offset?, limit?, locator?)`
- PDF / DOCX / PPTX / XLSX stay explicit document types instead of being silently converted to Markdown companions
- the demo MCP now keeps an internal cache under `/data/document-cache`
  - `manifest.json` for cached units/search metadata
  - `canonical.md` for normalized markdown
  - `parse_result.json` for the local `doc_extract`-style parse package
  - `images/` for extracted visual assets referenced from Markdown
  - cache warmup runs on service startup and on upload
  - markdown windows expose `images/...` plus `image_read_args`; reading that image locator with `document_read` returns the MCP image content block
- Canonicalization stays inside the external MCP demo instead of changing the generic agent prompt/runtime
  - the local parse package exposes Markdown plus `images/...` paths in `parse_result.json`
  - canonical markdown prefers `markitdown` when available and falls back to the parsed document blocks

## Start

The simplest operator entrypoint is:

```bash
make demo-start
```

`make demo-start` is the only supported demo boot command. It prepares local
Python and Node dependencies, then starts bind-mounted containers so source
edits in `frontend/demo` and `frontend/demo/mcp-file-service` apply without
rebuilding the demo images.

Other minimal commands:

```bash
make demo-status
make demo-stop
```

`make demo-start` no longer requires an untracked `frontend/demo/.env.local`
file. The compose stack ships with a committed
`frontend/demo/.env.defaults`, and `scripts/demo.sh` automatically prefers
`frontend/demo/.env.local` when you have one from runtime setup.

The UI package can also be built as a standalone frontend from this directory:

```bash
pnpm install --frozen-lockfile
pnpm build
```

The standalone build does not require `frontend/app` or any `@/core` alias from
the main OpenAgents web app.

On first run, the helper builds one local OCR base image for the MCP service and
reuses it on later runs. That base image includes:

- `tesseract-ocr`
- `tesseract-ocr-eng`
- `tesseract-ocr-chi-sim`
- `markitdown[all,xlsx]`
- `pymupdf`

Relevant environment variables:

- `MCP_WORKBENCH_NETWORK` overrides the Docker network used by the demo stack.
  When omitted, `make demo-start` prefers `openagents-prod_openagents` if it
  exists, then falls back to `openagents_default`.
- `MCP_WORKBENCH_OCR_LANGUAGES`
- `MCP_WORKBENCH_TESSERACT_BIN`
- `MCP_WORKBENCH_CACHE_DIR`
- `DEMO_NPM_REGISTRY` defaults to `https://registry.npmmirror.com`
- `DEMO_PYTHON_INDEX_URL` defaults to `https://mirrors.aliyun.com/pypi/simple/`
- `DEMO_APT_DEBIAN_MIRROR` defaults to `http://mirrors.aliyun.com/debian`
- `DEMO_APT_SECURITY_MIRROR` defaults to `http://mirrors.aliyun.com/debian-security`

The local file-service container does not execute host-generated console entry
points directly. Instead it keeps using the container's Python 3.12 runtime and
extends `PYTHONPATH` with `/app/.venv/lib/python3.12/site-packages`, which
avoids host/container shebang path drift while still reusing the host-managed
`uv` environment.

The mirror defaults above are intentionally scoped to the demo helper and demo
image builds. Override them per host when another registry is faster; no global
`npm`, `pnpm`, `pip`, or `uv` configuration is rewritten.

## Stop

```bash
make demo-stop
```

## Typical flow

1. Open `http://127.0.0.1:8084`
2. Drag files or an entire folder into the Explorer panel, or use `上传目录` / `上传文件`
3. Confirm the directory chips keep the first folder segment, for example `案例大全 · 4`
4. Confirm the MCP URL shown by the connection panel
5. Use the Explorer tree to select a file or folder-like category
6. The middle panel follows the agent-visible `document_*` tools returned by live `tools/list` scanning
7. Use `document_list` for inventory/browse, `document_search` for grep-style retrieval, and `document_read` for page/slide/sheet/region reading
8. Execute the tool and inspect arguments, output, and invocation history on the right

For external SDK / demo-agent binding, use the agent-facing `Agent MCP URL`.
The workbench keeps the full endpoint for manual debugging, but it now mirrors
the same document contract instead of exposing a second overlapping tool family.
