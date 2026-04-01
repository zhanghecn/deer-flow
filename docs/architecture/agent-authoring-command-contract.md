# Agent Authoring Command Contract

This document defines the canonical slash-command contract for agent and skill authoring flows.

It exists to prevent the system from smuggling model reasoning into the frontend, gateway, or backend command parser.

For the broader rule covering non-command heuristics as well, see
`docs/architecture/runtime-semantic-boundary.md`.

## Core Principle

Slash commands are workflow-routing primitives, not natural-language semantic parsers.

That means:

- `/create-agent` selects the agent-authoring workflow
- `/create-skill` selects the skill-authoring workflow
- `/save-*` and `/push-*` select explicit persistence workflows

It does **not** mean:

- frontend regex should guess the target agent from the user's sentence
- backend command resolution should guess the target skill from free text
- middleware guards should depend on guessed business entities before they activate

## Allowed Parsing Outside The Model

The non-model layers may do syntax-level parsing only:

- detect whether input starts with `/`
- extract the slash command token
- preserve the raw argument tail as `command_args`
- forward explicit structured UI values that already exist outside free text

Examples of allowed structured values:

- a new-agent page field where the user explicitly typed the new agent name
- a dropdown or picker that selected an existing agent or skill

Examples of forbidden parsing:

- regex over the chat text to derive `target_agent_name`
- regex over the chat text to derive `target_skill_name`
- heuristics such as "if the sentence contains `skill foo`, use `foo` as the target"

## Responsibility Split

### Frontend

Frontend may:

- detect slash command names for UI routing
- forward `command_name`, `command_args`, and `original_user_input`
- forward explicit structured target identifiers from dedicated UI fields

Frontend must not:

- infer authoring targets from free-form user text

### Gateway

Gateway may:

- proxy slash-command payloads
- preserve explicit structured metadata

Gateway must not:

- add business-entity inference for agent or skill targets

### Backend command resolution

Backend command resolution may:

- normalize the slash command token
- load command markdown and `authoring_actions`
- render command prompt templates

Backend command resolution must not:

- infer target agent names
- infer target skill names

## Tool Contract Rule

Business targets belong in tool parameters.

Canonical examples:

- `setup_agent(agent_name=..., ...)`
- `save_agent_to_store(agent_name=...)`
- `push_agent_prod(agent_name=...)`
- `save_skill_to_store(skill_name=...)`
- `push_skill_prod(skill_name=...)`

The only allowed implicit default is self-edit:

- when the current runtime agent is a non-`lead_agent` dev agent, agent-authoring tools may default to that current agent

`lead_agent` must pass explicit target names.

## Guard Rule

Authoring guards activate from command state, not inferred targets.

Examples:

- `/create-agent` activates the create-agent guard even before a target name has been decided
- `/push-skill-prod` activates the direct authoring guard because the user explicitly confirmed a publish workflow

Guards must not wait for inferred `target_*` fields from free text before they begin protecting the workflow.

## No-Fallback Rule

Once tool parameters become the canonical source of authoring targets:

- remove frontend target inference
- remove backend target inference
- remove middleware branches that depend on inferred targets
- fail explicitly when a required tool argument is missing

Do not keep dual behavior such as:

- "try explicit tool arg, else try inferred runtime target"
- "frontend guessed target, backend guesses again if missing"

## Opencode Alignment

This repository aligns with the opencode command model for slash-command routing.

Local source-of-truth for that comparison:

- relative path: `../opencode`
- current absolute path in this workspace: `/root/project/ai/opencode`

Check these files before claiming alignment:

- `../opencode/packages/app/src/components/prompt-input.tsx`
- `../opencode/packages/opencode/src/config/config.ts`
- `../opencode/packages/opencode/src/session/prompt.ts`

- commands are thin routing/template objects
- model reasoning stays with the runtime agent
- tool calls carry the structured execution target

This section is intentionally about slash commands only.

Do not use it as blanket justification for OpenAgents runtime skill changes.
`opencode` skill discovery/loading is a separate mechanism from the OpenAgents
runtime copied-skill contract, where the model reads attached copied
`SKILL.md` files from `/mnt/user-data/agents/{status}/{name}/skills/...`.

Any future change to slash-command behavior should be reviewed against this contract first.
