# MCP Integration Memory

## External Knowledge Boundary

- This repo is a general-purpose agent SDK/runtime. Hosted knowledge-base
  ingestion is optional; external customers may keep knowledge assets outside
  OpenAgents and expose them through MCP.
- MCP-backed multimodal retrieval for images/PDFs is a product requirement, not
  a demo-only patch.
- Do not solve external KB retrieval by exposing overlapping local filesystem
  tools to the same KB agent or by adding demo-specific prompt glue to generic
  runtime layers.
- Source: migrated from `.omx/project-memory.json`;
  [docs/architecture/knowledge-base.md](/root/project/ai/deer-flow/docs/architecture/knowledge-base.md).

## Multimodal Content Handling

- Detect MCP image content from standard MCP content blocks such as `type:
  image` with base64 and MIME fields.
- Do not use `mcp__` tool-name prefixes to decide whether image content reaches
  the model. Tool-name prefixes are naming, permission, and routing details only.
- Use structured MCP metadata such as `is_mcp` / `mcp_info` when provenance
  matters for trace labels.
- Source: migrated from `.omx/project-memory.json`; Claude Code reference
  checked locally in `/root/project/ai/claude-code/src/services/mcp/client.ts`.

## 8084 Demo Scope

- MCP document/demo work belongs in `frontend/demo` and port `8084`.
- The demo MCP service is the external knowledge side for support demos.
- Do not move demo-specific assumptions into `lead_agent` prompts, generic MCP
  loading, gateway MCP validation, or agent setup/materialization.
- Current 8084 agent-facing document surface is:
  - `document_list`
  - `document_search`
  - `document_read`
- Older `document_fetch_asset` references are superseded.
- Source: [frontend/demo/README.md](/root/project/ai/deer-flow/frontend/demo/README.md);
  [docs/testing/results/2026-04-17-support-sdk-demo-runtime/README.md](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/README.md).

## Document Read Shape

- `document_read(path)` returns cached canonical Markdown with `images/...` links
  and `image_read_args`.
- `document_read(path, locator="images/...")` returns the cached image through
  the same tool as a standard MCP image content block.
- This keeps image handling aligned with Claude Code: tool results carry
  standard image blocks, and the client/runtime prepares those blocks for the
  model.
- Source: commits `e2b651b2` and `e5c4eec3`.

## Superseded MCP Memory

- Older notes saying the 8084 agent-facing MCP surface includes
  `document_fetch_asset` are superseded by the three-tool surface above.
- Older demo notes mentioning overlapping `fs_*` plus `document_*` surfaces
  should be read as historical context. The current guidance is single-contract
  document tooling for the demo agent.
