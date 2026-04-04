---
name: contract-review
description: "Contract review skill that adds comment-based issue annotations without changing original text. Enforces a four-layer review (entity verification, basic, business, legal), writes structured comments (issue type, risk reason, revision suggestion) with risk level encoded via reviewer name, and generates a contract summary, consolidated opinion, and Mermaid business flowchart (with rendered image). Output language must follow the contract’s language."
---

# Contract Review Skill

## Overview

This skill performs contract reviews by **adding comments only** (no edits to the original text). It follows a four-layer review (entity verification, basic, business, legal) and generates:

- Annotated contract (.docx)
- Contract summary (.docx)
- Consolidated review opinion (.docx)
- Business flowchart (Mermaid + rendered image)

**Language rule:** detect the contract’s dominant language and output all generated content (comments, summary, opinion, flowchart text) in that language. Use the guidance in **[references/language.md](references/language.md)**.

## Workflow

1. Unpack the contract (.docx) for XML operations
2. Read contract text (pandoc or XML)
3. Extract and verify contracting parties (Layer 0)
4. Execute three-layer clause review (Layer 1–3)
5. Add comments to the document
6. Generate contract summary
7. Generate consolidated opinion
8. Generate business flowchart and render image
9. Repack to .docx

## Operating Modes

This skill supports two execution modes. Pick the mode that matches the material the user actually supplied.

### Mode A: Editable Contract File

Use this mode when the user supplied a writable contract file such as `.docx` and expects annotated deliverables.

- Follow the default workflow above
- Add comments to the document
- Generate the packaged output files described below

### Mode B: Knowledge-Base Review

Use this mode when the contract is attached through the knowledge base and you are reviewing PDF / Word / Markdown content in chat.

- Replace the editable-file workflow with this KB-only workflow:
  1. Read **[references/checklist.md](references/checklist.md)** and use it as the full coverage checklist.
  2. Use knowledge tools to locate the target document and relevant node ranges.
  3. Fetch current-turn evidence with `get_document_evidence(...)` before writing any substantive finding.
  4. Review in strict order: Layer 0 -> Layer 1 -> Layer 2 -> Layer 3.
  5. Produce either a chat answer or a single markdown/text report, depending on what the user requested.
- Do **not** pretend you edited the original contract or generated a commented `.docx` unless the user also supplied an editable file and explicitly asked for that deliverable.
- Do **not** generate Mermaid flowcharts, rendered images, repacked documents, or other extra artifacts in Mode B unless the user explicitly asks for those deliverables.
- Unless the user explicitly asked for a downloadable file, markdown file, text file, or report artifact, the default Mode B output is a **visible chat answer only**.
- If you still create any optional artifact because the user explicitly asked for it, you must also provide a substantive visible answer in chat in the same turn. Do **not** end with only an artifact card or an empty assistant reply.
- Use the knowledge tools as the document source of truth for the contract text.
- Read evidence before analysis; do not answer from tree summaries alone.
- Read **[references/checklist.md](references/checklist.md)** and use it as the coverage checklist for the review instead of sampling only a few representative issues.
- Before drafting the visible answer, convert the checklist into a visible coverage plan. For Layer 1-3, account for every top-level checklist category from `references/checklist.md`.
- Complete the same Layer 0 -> Layer 3 review order, but present the result as a grounded review opinion in chat or a text/markdown report.
- Every substantive finding must stay tied to current-turn evidence and include the exact citation returned by the knowledge tool.
- If you generate a markdown/text report in Mode B, the report itself must also preserve the exact citation markdown after each substantive finding. Do not keep citations only in chat prose.
- If the knowledge-base document is a blank template, sample contract, or official model form, say so explicitly. Only identify risks supported by the visible clause text, blank fields, or attached notes. Do not invent customized clauses that are not present in evidence.
- For blank/template/model contracts, separate **blank fields** from **prefilled default clauses**. Blank fields do not excuse review of already-written default allocations such as renewal, price adjustment, deposit/refund, repair/maintenance allocation, termination, dispute forum, and other visible risk-bearing clauses.
- For lease / tenancy contracts, when the reviewed text contains them, you must make these clause families visible in the answer as either concrete findings or explicit no-issue coverage statuses rather than leaving them implicit inside a broad category summary:
  - deposit / refund conditions and deductions
  - renewal / extension mechanism and any rent repricing
  - maintenance / repair allocation
  - landlord early termination, eviction, or repossession rights
  - premises handover / return standard
  - dispute forum
- For blank/template/model contracts, do **not** treat an absent clause category by itself as a standalone Layer 1-3 trap. If a category is not present in evidence, record it as **not found in the reviewed text** or **still blank** instead of upgrading it into a concrete risk finding.
- For checklist categories that were reviewed but not found in the text, say so explicitly instead of silently omitting them. Coverage must be visible, not implied.
- Keep the visible answer fully in the contract language. Do not mix in English side notes such as `(irrelevant for lease)` when the contract language is Chinese.

## Output Naming

- Output directory: `审核结果：{ContractName}` for Chinese or `Review_Result_{ContractName}` for English
- Reviewed contract: `{ContractName}_审核版.docx` for Chinese or `{ContractName}_Reviewed.docx` for English
- Review report: `审核报告.txt` for Chinese or `Review_Report.txt` for English

## Comment Principles

- **Comments only**: do not modify the original text or formatting
- **Precise anchoring**: comment should target specific clauses/paragraphs
- **Structured content**: each comment includes issue type, risk reason, and revision suggestion
- **Risk level**: carried by reviewer name; do **not** include a “risk level” line in comment body
- **Output language**: use labels in the contract’s language (see `references/language.md`)

**Comment example (English):**
```
[Issue Type] Payment Terms
[Risk Reason] The total amount is stated as USD 100,000 in Section 3.2, but the payment clause lists USD 1,000,000 in Section 5.1. This inconsistency may cause disputes.
[Revision Suggestion] Align the total amount across clauses and clarify whether tax is included.
```

## Review Standards

Use the four-layer review model and the detailed checklist in **[references/checklist.md](references/checklist.md)**.

### Layer 0: Entity verification (subject authenticity)
- Extract all contracting parties (full legal names, credit codes, legal representatives)
- Verify each entity's registered name accuracy and business registration status
- **Verification tool priority:**
  1. If an MCP tool for business registration lookup is available in the current environment (e.g., enterprise info query, company lookup, 企业查询, 工商查询), use it to query each party's name or Unified Social Credit Code.
  2. If no such MCP tool is available, use Web Search to look up "[entity name] 工商登记信息" or "[entity name] business registration".
  3. Record the verification source (MCP tool name / Web Search) in the comment.

### Layer 1: Basic (text quality)
- Accuracy of numbers, dates, terms
- Consistent numbering and references
- Clarity and lack of ambiguity
- Formatting and punctuation quality

### Layer 2: Business terms
- Scope, deliverables, quantity/specs
- Pricing and payment schedule
- Delivery/acceptance procedures
- Rights/obligations and performance guarantees

### Layer 3: Legal terms
- Effectiveness and term/termination
- Liability/penalties and remedies
- Dispute resolution and governing law
- Confidentiality, force majeure, IP, notice, authorization

**Risk levels (encoded in reviewer name):**
- 🔴 High: core business ambiguity (price, scope, rights/obligations)
- 🟡 Medium: material but non-core ambiguity
- 🔵 Low: minimal practical impact

## Contract Summary

Generate a structured, objective summary in the contract’s language.
- See **[references/summary.md](references/summary.md)** (English template)
- Use **[references/language.md](references/language.md)** for language selection and Chinese labels

Output file: `合同概要.docx` for Chinese or `Contract_Summary.docx` for English (default font: 仿宋; adjust if language requires)

## Consolidated Opinion

Generate a concise, two-paragraph response for the business team in the contract’s language.
- See **[references/opinion.md](references/opinion.md)**

Output file: `综合审核意见.docx` for Chinese or `Consolidated_Opinion.docx` for English (default font: 仿宋; adjust if language requires)

## Business Flowchart (Mermaid)

Generate Mermaid flowchart per requirements and render to image.
- See **[references/flowchart.md](references/flowchart.md)**

Outputs:
- `business_flowchart.mmd`
- `business_flowchart.png`

## Knowledge-Base Review Output

When running in **Mode B: Knowledge-Base Review**, structure the visible answer in the contract's language and keep it grounded to evidence:

1. Contract nature
2. Layer 0 entity verification result
3. Layer 1 coverage table, then Layer 1 findings
4. Layer 2 coverage table, then Layer 2 findings
5. Layer 3 coverage table, then Layer 3 findings
6. Negotiation / revision suggestions
7. Explicit note about any unreviewable, not-found, or still-blank fields

For each concrete finding:

- identify the issue type
- explain the risk reason
- give a revision suggestion
- attach the exact current-turn citation markdown

Coverage table contract for Mode B:

- Under Layer 1-3, list every top-level checklist category from `references/checklist.md`.
- Each category must show one of these statuses in the answer language:
  - `发现问题`
  - `未见实质性问题`
  - `未在审查文本中发现`
  - `仍为空白`
  - `当前证据不足`
- The coverage table is mandatory even when a layer has only a few concrete findings.
- Only escalate a category into a concrete risk finding when the current-turn evidence shows an actual clause, blank field, or note supporting that finding.

Coverage rules for Mode B:

- Use **[references/checklist.md](references/checklist.md)** as the review checklist. Under Layer 1-3, make it explicit which checklist categories were reviewed instead of stopping after a few sample findings.
- For blank/template/model contracts, still review every **prefilled default clause**. Keep those findings separate from blank fields that still need completion.
- If a checklist category is absent or the relevant field is blank, say it was **not found in the reviewed text** or is **still blank**.
- For blank/template/model contracts, keep absent clause categories out of the main risk findings unless the reviewed text itself contains the clause language.
- If no evidence supports a suspected risk, say it was **not found in the reviewed text** instead of inferring it.
- When the user asked for "全面审查" or similar broad review wording, the answer is incomplete unless Layer 1-3 all show visible checklist coverage, including categories with **not found in reviewed text** / **still blank** status.

## Technical Notes

Core workflow:
1. Unpack → 2. Entity verification → 3. Add comments → 4. Summary → 5. Opinion → 6. Flowchart → 7. Repack

API & implementation details:
- **[references/technical.md](references/technical.md)**

## Dependencies

- Python 3.9+ (3.10+ recommended)
- pandoc (system install)
- defusedxml
- Mermaid CLI (`mmdc`) for rendering
- python-docx for rich text output

## Troubleshooting (Short)

- **Comments missing in Word**: run `doc.verify_comments()` and re-save
- **find_paragraph fails**: shorten search text; confirm actual paragraph text
- **Mermaid render fails**: ensure `mmdc` installed; use Chrome path or Puppeteer config

## Examples

See **[references/examples.md](references/examples.md)** for a full workflow example.

## Important Rules

1. Never alter original contract text
2. Entity verification (Layer 0) must complete before clause review (Layers 1–3)
3. Review all four layers, do not skip items
4. Ensure risk level is accurate and consistent
5. Keep comments precise, professional, and actionable
6. Flowchart must come strictly from the contract text
7. Summary is objective only; no risk analysis
8. Opinion only reflects findings already identified
9. For knowledge-base reviews, cite every substantive finding with the exact current-turn knowledge citation
10. Do not claim hidden clauses, negotiated inserts, or customized traps unless they appear in the reviewed evidence
11. If the material is an official template or blank model contract, classify it as such and separate “actual clause risk” from “fields still need lawful completion”
12. For knowledge-base reviews, read `references/checklist.md` and use it as the coverage checklist instead of stopping after a few representative findings
13. For blank/template/model contracts, review visible default clauses separately from blank fields; blank fields do not cancel review of already-written clauses
14. For blank/template/model contracts, absent clause categories must be labeled as `not found in reviewed text` or `still blank`, not as standalone Layer 1-3 risk findings
15. In Mode B, default to a grounded chat answer; only create extra report artifacts when the user explicitly asks for a downloadable file or when a report file is itself the requested deliverable
16. In Mode B, any generated markdown/text report must keep the exact citation markdown inline with each substantive finding
17. In Mode B, Layer 1-3 are incomplete unless every top-level checklist category appears in a visible coverage table with an explicit status

## License

SPDX-License-Identifier: Apache-2.0

Copyright (c) 2026 JiCheng

Licensed under the Apache License, Version 2.0. See repository root `LICENSE`.
