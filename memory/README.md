# Memory Index

This directory is the durable coding-agent memory for the repository. It stores
project-continuity knowledge that should shape future development, while
`docs/**` stays focused on human-facing architecture, guides, testing specs, and
recorded verification documents.

## Structure

- `directives/`
  - standing engineering rules distilled from `.omx` memory, AGENTS files, and
    recurring review outcomes
- `integrations/`
  - durable integration contracts for public API, MCP, demo surfaces, and
    external customer data boundaries
- `operations/`
  - current stack, verification entrypoints, accounts, and environment notes
- `archive/`
  - historical plans and analyses moved out of `docs/`; useful context, not
    current source of truth

## Migration Rules

- Put durable future-work constraints here, not in `.omx/project-memory.json` or
  `.omx/notepad.md`.
- `.omx/**` is local runtime/session state. Use it as a source to migrate from,
  then delete redundant memory cache files after migration.
- Do not copy full docs into memory. Summarize the rule and link to the source
  document or commit.
- Do not move current human docs out of `docs/architecture`, `docs/guides`, or
  `docs/testing` unless they are actually historical planning notes.

## Read Order

For broad repo work, read:

1. `directives/testing-and-verification.md`
2. `directives/runtime-boundaries.md`
3. `integrations/mcp.md`
4. `integrations/public-api.md`
5. `operations/current-stack.md`

For historical context, read files under `archive/` only after the current docs
and directives above.
