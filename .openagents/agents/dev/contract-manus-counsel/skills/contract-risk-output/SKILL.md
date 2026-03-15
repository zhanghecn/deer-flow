---
name: contract-risk-output
description: Synthesize topic findings into an executive summary, risk matrix, and clause-by-clause contract review report.
---

# Contract Risk Output

Use this skill after topic findings are available.

## Goals

- Convert raw topical findings into a business-usable legal review report.
- Highlight negotiation priorities, not just legal defects.
- Produce one clean artifact in `/mnt/user-data/outputs/contract_review_report.md`.

## Required Sections

1. Executive Summary
2. Risk Matrix
3. Clause-by-Clause Review
4. Open Questions
5. Negotiation Priorities

## Risk Matrix Columns

- Topic
- Clause
- Risk Level
- Why It Matters
- Recommended Action

## Clause-by-Clause Review Format

For each finding include:

- clause reference
- short quote or precise evidence pointer
- risk explanation
- proposed redline
- fallback position

## Writing Rules

- Keep the executive summary compact and decision-oriented.
- Sort `RED` findings before `YELLOW`, then `GREEN`.
- If the user has a stated commercial position, reflect it in the recommended redlines.
- Explicitly mark assumptions and missing facts.
