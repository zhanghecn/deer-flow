---
name: nda-clause-checker
description: Extract and analyze risk clauses from Non-Disclosure Agreements (NDAs), outputting a structured risk checklist with severity ratings, issue descriptions, and recommended redlines. Use when reviewing NDA documents, identifying potential risks in confidentiality agreements, or when the user asks to "check this NDA", "review this NDA", "analyze NDA risks", or "extract NDA clauses".
---

# NDA Clause Checker

Extract risk clauses from NDA documents and output a structured risk checklist.

## Workflow

1. **Identify NDA type**: Determine if unilateral (one-way), bilateral/mutual, or multilateral
2. **Extract clauses**: Parse document for key provisions
3. **Assess risks**: Evaluate each clause against the risk framework
4. **Generate output**: Produce structured risk checklist

## Clause Categories

Scan the NDA for these clause types:

| Category | Key Clauses |
|----------|-------------|
| Definition | Confidential information scope, exclusions, marking requirements |
| Duration | Agreement term, confidentiality period, survival clause |
| Obligations | Use restrictions, safeguarding duties, disclosure limits |
| Exceptions | Public info, prior knowledge, independent development, legal compulsion |
| Liability | Indemnification, limitation of liability, liquidated damages |
| Remedies | Injunction rights, specific performance, breach consequences |
| Jurisdiction | Governing law, venue, dispute resolution |
| Hidden Risks | Non-compete clauses, IP assignment, non-solicitation |

## Risk Severity Levels

| Level | Criteria |
|-------|----------|
| 🔴 **High** | Unenforceable terms, unlimited liability, hidden non-compete, unreasonable duration, jurisdiction disadvantage |
| 🟡 **Medium** | Vague definitions, missing standard exceptions, one-sided obligations, unclear remedies |
| 🟢 **Low** | Minor drafting issues, non-standard but acceptable terms, suggestions for clarity |

## Output Format

```markdown
# NDA Risk Analysis Report

## Document Overview
- **Document Type**: [Unilateral/Bilateral/Multilateral NDA]
- **Parties**: [Disclosing Party] → [Receiving Party]
- **Agreement Term**: [Duration]
- **Governing Law**: [Jurisdiction]

## Risk Summary
| Severity | Count |
|----------|-------|
| 🔴 High | X |
| 🟡 Medium | Y |
| 🟢 Low | Z |

## Detailed Risk Checklist

### 🔴 High Risk Issues

#### 1. [Issue Title]
- **Clause Location**: [Section/Paragraph reference]
- **Original Text**: > "[Exact clause text]"
- **Risk Description**: [Why this is problematic]
- **Recommended Redline**: [Specific suggested change]
- **Rationale**: [Business/legal reasoning]

### 🟡 Medium Risk Issues
[Same format]

### 🟢 Low Risk Issues
[Same format]

### ✅ Standard/Acceptable Clauses
- [List properly drafted clauses]

## Recommendations

1. **Priority 1**: [Most critical action item]
2. **Priority 2**: [Second priority]
3. **Priority 3**: [Third priority]
```

## References

For detailed analysis criteria, read these reference files:

- **references/definition-clauses.md** - Confidential information definition analysis
- **references/duration-exceptions.md** - Term, survival, and standard exceptions
- **references/obligations-liability.md** - Party obligations and liability provisions
- **references/hidden-risks.md** - Hidden clauses and red flags