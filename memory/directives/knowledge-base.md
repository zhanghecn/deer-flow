# Knowledge Base Memory

## Agent Retrieval Contract

- Knowledge bases expose source workspace files mounted read-only for runtime
  agents under `/mnt/user-data/knowledge/{workspace-name}__{workspace-id}/sources/`.
- Do not reintroduce agent-facing compiled/wiki/cache paths such as `wiki/**`,
  `.llm-wiki/**`, or `raw/sources/.cache/**`.
- The runtime prompt should stay concise: expose attached workspace metadata and
  `mount_path` values only. Retrieval then uses the existing filesystem tools
  inside those read-only mounts.
- Do not reintroduce semantic KB tools or PageTree retrieval as the default
  agent-facing path. Graph views may derive from real links in source Markdown,
  not model-generated concept/synthesis pages.
- Knowledge Asset Store refs are opaque implementation details. Prompts and
  skills must not expose host paths, MinIO keys, or `.openagents/knowledge/...`.
- Source:
  [docs/architecture/knowledge-base.md](/root/project/ai/deer-flow/docs/architecture/knowledge-base.md).
