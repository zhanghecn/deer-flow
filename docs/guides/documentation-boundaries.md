# Documentation Boundaries

This document separates the repository's documentation into distinct audiences and contracts.

Use it to avoid mixing:

- repository engineering docs for humans
- coding-agent collaboration docs for Codex/Claude when modifying this repo
- runtime agent contracts consumed by OpenAgents itself at execution time

## 1. Repository Engineering Docs

Audience:

- maintainers
- contributors
- operators

Examples:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture/runtime-architecture.md`
- `docs/architecture/remote-backend.md`
- `docs/architecture/knowledge-base.md`
- `docs/testing/**`
- service/module `README.md` files

Purpose:

- explain current architecture
- explain developer workflow
- explain testing and operations
- define human-facing source-of-truth docs for the repo

## 2. Coding-Agent Collaboration Docs

Audience:

- Codex / Claude / similar coding agents modifying this repository

Examples:

- top-level `AGENTS.md`
- subtree `AGENTS.md`
- `backend/agents/CLAUDE.md`

Purpose:

- constrain how coding agents should inspect, edit, test, and reason about this repo
- record repository-specific engineering rules that should shape code changes

These docs are about how to change the repository, not about what the product runtime agent sees.

## 3. Runtime Agent Contracts

Audience:

- the OpenAgents runtime agent and its subagents at execution time

Examples:

- `.openagents/agents/{status}/{name}/AGENTS.md`
- `.openagents/skills/**/SKILL.md`
- runtime prompt code such as `backend/agents/src/agents/lead_agent/prompt.py`
- middleware-enforced tool protocols that shape model behavior

Purpose:

- define the instructions, path contract, and tool-usage contract visible to the runtime agent
- shape runtime retrieval, authoring, file usage, and answer behavior

These contracts are product/runtime behavior, not general contributor docs.

## 4. Default Review Boundary

When auditing whether "project docs" match the current architecture, the default scope is:

- repository engineering docs
- coding-agent collaboration docs

Do not automatically include runtime agent contracts in that audit unless the task explicitly asks to review:

- runtime prompts
- skills
- model-visible tool contracts
- agent answer behavior

## 5. Update Rules

If a change affects repository architecture or contributor workflow:

- update repository engineering docs
- update coding-agent collaboration docs when the change should constrain future agent edits

If a change affects only runtime agent behavior:

- update runtime agent contracts
- update repository engineering docs only if the human-facing architecture or supported behavior changed

If a change affects both:

- update both layers explicitly
- do not assume one layer implicitly documents the other

## 6. Practical Examples

- Changing `thread_bindings` ownership or persistence flow:
  update repo architecture docs and coding-agent docs; update runtime prompts only if model-visible behavior changes.
- Changing knowledge-base retrieval instructions shown to the runtime model:
  update runtime agent contracts first; update repo docs only if the architectural contract changed.
- Changing how contributors should run verification:
  update `docs/testing/**`, `CONTRIBUTING.md`, and any relevant `AGENTS.md`; do not treat runtime skill docs as the primary place for that rule.

## 7. Source-Of-Truth Reminder

For architecture and project-management discussions, prefer:

- `docs/**`
- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md` / subtree `AGENTS.md`

Treat `.openagents/**` and runtime prompt/skill content as a separate layer unless the task is explicitly about runtime agent behavior.
