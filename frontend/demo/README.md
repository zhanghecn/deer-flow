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

## Start

```bash
docker compose -f frontend/demo/compose.yaml up -d --build
```

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
6. Use the middle workbench to select one MCP tool such as `fs_ls`, `fs_read`, `fs_glob`, or `fs_grep`
7. Execute the tool and inspect arguments, output, and invocation history on the right
