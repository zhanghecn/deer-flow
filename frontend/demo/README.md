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
- an MCP Streamable HTTP endpoint at `http://127.0.0.1:8084/mcp-http/mcp`
- a manual tool execution endpoint at `http://127.0.0.1:8084/api/tools/{tool_name}/invoke`
- text-only `fs_read` / `fs_grep` semantics for generic filesystem behavior
- demo-only document tools:
  - `document_search(query, path?, cursor?, limit?)`
  - `document_read(path, cursor?, limit?)`
  - `document_fetch_asset(path, asset_ref)`
- PDF / DOCX / PPTX / XLSX stay explicit document types instead of being silently converted to Markdown companions

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

Do not bind-mount host Python or Node dependency directories into these
containers as a production strategy. Keep dependencies baked into the image and
treat Compose as an orchestrator that starts prebuilt images.

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
6. Use the middle workbench to select one MCP tool such as `fs_ls`, `fs_read`, `document_search`, or `document_read`
7. For PDF / Office files, prefer `document_search -> document_read -> document_fetch_asset`
8. Execute the tool and inspect arguments, output, and invocation history on the right
