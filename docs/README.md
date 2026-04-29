# Docs Index

This directory is organized by document type instead of keeping all repository docs flat at the top level.

## Structure

- `architecture/`
  - current architecture and system contracts
  - default source of truth for runtime/backend/KB/observability design
- `guides/`
  - repository-level guidance, boundaries, and operational deep dives
  - source of truth when the topic is workflow or repo documentation policy
- `testing/`
  - test entrypoints, specs, pitfalls, and recorded audits
  - source of truth for repository-level verification expectations

Historical plans, migration notes, and one-off analyses live under
`../memory/archive/` so this docs tree stays focused on current human-facing
documentation.

## Recommended Reading Order

For repo/documentation boundaries:

1. `guides/documentation-boundaries.md`
2. `../AGENTS.md` or the relevant subtree `AGENTS.md`

For runtime/backend/sandbox/remote architecture:

1. `architecture/runtime-architecture.md`
2. `architecture/remote-backend.md`
3. `architecture/knowledge-base.md`
4. `testing/README.md`

For contributor workflow:

1. `../CONTRIBUTING.md`
2. `testing/README.md`

For Docker development, release, and deployment:

1. `guides/docker-compose-prod-selfhost-zh.md`

## Source-Of-Truth Rule

When someone asks whether the "project docs" match the code, default to:

- `architecture/`
- `guides/`
- `testing/`
- top-level `README.md`
- top-level `CONTRIBUTING.md`
- relevant `AGENTS.md`

Do not automatically treat `../memory/archive/` as current source of truth.
