# Runtime Semantic Boundary

This document records the architectural boundary between:

- explicit structured parsing outside the model
- semantic understanding that must stay with the runtime model

It exists because these two responsibilities drift easily and, once mixed,
frontend helpers and backend middleware start behaving like weak shadow models.

Related documents:

- `docs/architecture/agent-authoring-command-contract.md`
- `docs/architecture/runtime-architecture.md`
- `docs/architecture/slash-command-authoring-runtime-flow.md`

## Core Rule

Natural-language understanding belongs to the model.

Non-model layers may parse syntax, validate explicit identifiers, and consume
machine-readable payloads, but they must not inspect free-form user or assistant
text and then make business decisions on the model's behalf.

## Allowed Outside The Model

The following are valid non-model responsibilities:

- slash command syntax parsing
  - detect `/`
  - extract command token
  - preserve raw `command_args`
- explicit mention syntax parsing
  - examples: `@document`, `@doc[...]`, `@"..."`, `@knowledge[...]`
- machine-readable payload parsing
  - examples: `<next_steps>...</next_steps>` JSON
  - `question_result` JSON
  - `<uploaded_files>...</uploaded_files>` tag boundaries
- explicit UI field forwarding
  - examples: selected `target_agent_name`, selected knowledge base IDs
- local UI filtering over already-loaded visible lists
  - examples: search box filtering rendered knowledge-base names
- validation and safety checks
  - examples: safe agent-name regex, host-path blocking, path-shape validation
- tool-state and tool-result inspection
  - examples: "did this turn already call `get_document_evidence`?"
  - "did the current evidence payload include this exact `image_path`?"

These are all syntax-, protocol-, or safety-level responsibilities.

## Forbidden Outside The Model

The following are architectural violations:

- inferring target agents, target skills, or domain entities from free-form user text
- inferring next-step runtime switches from assistant prose such as:
  - "switch to X agent"
  - "continue in the current thread"
- inferring knowledge-base modes from keyword lists such as:
  - visual mode
  - debug parsing mode
  - review mode
- inferring intake/question-gating requirements from research/scale keywords
- building middleware that re-interprets natural-language user constraints and rewrites output policy from them
- keeping prompt/formatter contracts weak and then "fixing" drift with post-hoc regex cleanup in later layers
- adding fallback heuristics after a structured field or tool protocol already exists

If a business decision needs to happen outside the model, the decision input
must be turned into an explicit structured field first.

## Canonical Sources Of Truth

When a non-model layer must act on business state, prefer these sources only:

- explicit UI fields owned by the UI
- tool arguments
- tool return payloads
- machine-readable assistant output blocks
- runtime-visible files the model can read directly

Do not create parallel truth from:

- raw user prose
- raw assistant prose
- guessed context from prior UI state
- ad-hoc keyword tables

## Current Approved Structured Parsers

These are current examples of acceptable parsing:

- `frontend/app/src/core/commands/transform.ts`
  - parses slash syntax and explicit `@document` mention syntax only
- `backend/agents/src/knowledge/references.py`
  - resolves explicit `@document` mention syntax to attached knowledge docs
- `frontend/app/src/core/messages/utils.ts`
  - parses `<next_steps>` JSON and trusts only explicit fields such as `agent_name`
- `backend/agents/src/agents/memory/prompt.py`
  - strips `<uploaded_files>` tag blocks at conversation-formatting boundary

## Patterns Explicitly Removed

These patterns were intentionally removed and must not be reintroduced:

- frontend next-step prompt regex that guessed `agent_name`
- frontend heuristics that guessed whether a next step must stay in the current thread
- knowledge middleware keyword tables for debug/visual mode
- knowledge middleware free-text document-name matching to trigger KB guard behavior
- question middleware keyword gating for "large-scale research"
- target-length retry middleware that re-parsed natural-language length goals and rewrote outputs in middleware
- memory updater regex cleanup that tried to scrub upload events after prompt/formatter stages

## Review Checklist

Before merging any frontend helper, gateway adapter, or backend middleware that
inspects text, ask:

1. Is this parsing explicit syntax or machine-readable structure?
2. Or is it trying to understand meaning from natural language?
3. If it is understanding meaning, can the model own that step instead?
4. If not, can the UI/tool protocol expose an explicit field so no guessing is needed?

If the answer depends on keyword tables, fuzzy matching, or regex over user/assistant
prose to derive business meaning, the change is almost certainly on the wrong side
of the boundary.
