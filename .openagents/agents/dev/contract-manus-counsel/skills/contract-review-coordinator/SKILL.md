---
name: contract-review-coordinator
description: Plan topic-based contract review work and coordinate subagent or batch review passes.
---

# Contract Review Coordinator

Use this skill after indexing is complete and before detailed findings are produced.

## Goals

- Turn the clause index into a concrete review plan.
- Split the contract into topic-specific review passes.
- Use `task` / subagents when available; otherwise execute the same plan in sequential batches.

## Topics

- Parties and definitions
- Pricing and payment
- Delivery, SLA, acceptance, change control
- IP, confidentiality, data processing
- Representations, warranties, indemnity, liability
- Term, renewal, termination, exit
- Governing law, dispute resolution, compliance

## Review Packet

For each topic, prepare a packet with:

- relevant clause references
- short summaries from the index
- cross-topic dependencies
- required output schema

Each topic reviewer must return:

- `risk_level`
- `clause_reference`
- `evidence`
- `problem`
- `redline`
- `fallback`
- `open_questions`

## Execution Rules

- Prefer parallel topical review when delegation is enabled.
- If delegation is disabled, keep the same packet structure and review topic-by-topic.
- Save topic findings to `/mnt/user-data/workspace/contract-review/findings/<topic>.md`.
- Deduplicate repeated issues before synthesis.
