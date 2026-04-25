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
  - `document_list(path?, cursor?, limit?)`
  - `document_search(query, path?, cursor?, limit?)`
  - `document_read(path, cursor?, limit?)`
  - `document_fetch_asset(path, asset_ref)`
- PDF / DOCX / PPTX / XLSX stay explicit document types instead of being silently converted to Markdown companions
- the demo MCP now keeps an internal cache under `/data/document-cache`
  - `manifest.json` for cached units/search metadata
  - `canonical.md` for normalized markdown
  - `assets/` for extracted images
  - cache warmup runs on service startup and on upload
  - `ingest.ocr_status` / `ocr_languages` / `ocr_provider` stay in the manifest so OCR behavior is inspectable
- OCR and canonicalization stay inside the external MCP demo instead of changing the generic agent prompt/runtime
  - images and scanned PDFs are OCR'd by the MCP service
  - PPTX / DOCX / XLSX image assets are OCR'd before they enter `document_search`
  - canonical markdown prefers `markitdown` when available and falls back to the parsed document blocks

## Start

The simplest operator entrypoint is:

```bash
make demo-start
```

It automatically does the right thing in this order:

1. build from local source when you have demo edits
2. otherwise try the published GHCR demo images
3. fall back to a local build if no published image is available

Other minimal commands:

```bash
make demo-status
make demo-stop
```

`make demo-start` no longer requires an untracked `frontend/demo/.env.local`
file. The compose stack ships with a committed
`frontend/demo/.env.defaults`, and `scripts/demo.sh` automatically prefers
`frontend/demo/.env.local` when you have one from runtime setup.

You can still run plain Compose directly if needed:

```bash
docker compose -f frontend/demo/compose.yaml up -d --build
```

The demo Dockerfiles now use BuildKit cache mounts for `pip` and `pnpm`, so
repeat local rebuilds can reuse downloaded dependencies.

The file-service image also installs:

- `tesseract-ocr`
- `tesseract-ocr-eng`
- `tesseract-ocr-chi-sim`
- `markitdown[all,xlsx]`
- `pymupdf`

Relevant environment variables:

- `MCP_WORKBENCH_OCR_LANGUAGES`
- `MCP_WORKBENCH_TESSERACT_BIN`
- `MCP_WORKBENCH_CACHE_DIR`

For the default / production-style demo flow, keep dependencies baked into the
image and treat Compose as an orchestrator that starts prebuilt images.

## Local mounted-deps mode

When you are iterating on the 8084 demo locally and do not want every restart
to rebuild the Python service image or re-download frontend dependencies, use
the local mounted-deps flow:

```bash
make demo-local-deps
make demo-start-local
```

What it does:

1. Builds one local OCR base image for `mcp-file-service` system packages
2. Runs `uv sync --project frontend/demo/mcp-file-service --python 3.12 --frozen`
   to create `frontend/demo/mcp-file-service/.venv`
3. Runs `pnpm --dir frontend/demo install --frozen-lockfile`
4. Starts Compose with the whole demo project bind-mounted into the runtime
   containers, so source edits apply without rebuilding the app image

The local file-service container does not execute host-generated console entry
points directly. Instead it keeps using the container's Python 3.12 runtime and
extends `PYTHONPATH` with `/app/.venv/lib/python3.12/site-packages`, which
avoids host/container shebang path drift while still reusing the host-managed
`uv` environment.

This mode is intentionally local-only. It avoids repeated dependency pulls
while preserving the default image-baked path for reproducible demo publishing.

This repository also includes a GitHub Actions workflow at
`.github/workflows/publish-demo-images.yml` that publishes the demo images to
GHCR using these image names:

- `ghcr.io/<owner>/deer-flow-demo-mcp-file-service:<tag>`
- `ghcr.io/<owner>/deer-flow-demo-mcp-workbench-ui:<tag>`

## Stop

```bash
docker compose -f frontend/demo/compose.yaml down
```

## Typical flow

1. Open `http://127.0.0.1:8084`
2. Drag files or an entire folder into the Explorer panel, or use `上传目录` / `上传文件`
3. Confirm the directory chips keep the first folder segment, for example `案例大全 · 4`
4. Confirm the MCP URL shown by the connection panel
5. Use the Explorer tree to select a file or folder-like category
6. The middle panel follows the agent-visible `document_*` tools returned by live `tools/list` scanning
7. Use `document_list` for inventory/browse, `document_search` for semantic retrieval, and `document_read` for page/slide/sheet/region reading
8. Execute the tool and inspect arguments, output, and invocation history on the right

For external SDK / demo-agent binding, use the agent-facing `Agent MCP URL`.
The workbench keeps the full endpoint for manual debugging, but it now mirrors
the same document contract instead of exposing a second overlapping tool family.
