---
name: contract-indexing
description: Handle long contracts by chunking, indexing clauses, and writing intermediate notes before review.
---

# Contract Indexing

Use this skill when the contract is too long to inspect in one pass or when the clause structure is unclear.

## Goals

- Read the contract in chunks instead of assuming full-context access.
- Build a clause index that maps sections, headings, and important cross-references.
- Persist intermediate notes so later review passes do not need to reread the full document.

## Workflow

1. Create a working directory under `/mnt/user-data/workspace/contract-review/`.
2. If the user provided a URL instead of an uploaded file:
   - fetch the contract source first
   - save a stable copy under `/mnt/user-data/workspace/contract-review/source/`
   - prefer a cleaned text/Markdown copy for downstream review when available
3. Read the contract progressively.
   - Prefer converted Markdown/text versions of PDF/DOCX files when available.
   - Use pagination metadata from file tools to keep reading until the structure is clear.
4. Build `/mnt/user-data/workspace/contract-review/clause-index.json`.
5. Write short topic-neutral notes into `/mnt/user-data/workspace/contract-review/notes/`.
6. Return:
   - contract type guess
   - major section map
   - clauses needing cross-topic review
   - clauses that look immediately high risk

## Index Format

Each index item should contain:

- `section_id`
- `title`
- `start_reference`
- `end_reference`
- `summary`
- `cross_refs`
- `topics`

## Rules

- Do not dump the full contract into notes.
- Keep summaries short and evidence-oriented.
- Preserve enough references so later reviewers can quote the exact clause.
