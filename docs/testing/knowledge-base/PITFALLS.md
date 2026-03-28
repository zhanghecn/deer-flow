# Knowledge Base Pitfalls

## 1. Long-Running Stack May Not Be Current Code

`http://localhost:3000`, `8001`, and `2024` may be old dev processes.

Do not claim a backend/storage fix is verified only because the app UI still works.

Always distinguish:

- long-running shared dev stack result
- sidecar current-code verification result

## 2. Browser Test Is Mandatory

Unit tests and API smoke tests are not enough for knowledge-base tasks.

Common failures only visible in the real browser:

- missing entry point
- selector state not visibly applied
- preview pane layout broken
- citation click not jumping after repeated clicks
- upload/build progress UI desynced from backend state

## 3. `5173` Internal Audit Is Mandatory For Agent Claims

If the agent answer quality is under review, inspect `http://localhost:5173`.

Do not guess why the agent failed.

Typical internal failure modes:

- tool order is wrong
- tree request is too broad
- evidence was not refreshed in the same turn
- model answered from memory instead of grounded evidence
- image evidence existed but was not surfaced

## 4. `/large_tool_results` Usually Means Retrieval Design Is Too Broad

If knowledge tool output spills into `/large_tool_results/...`, do not treat it as normal.

Usually the real fix is:

- reduce root window size
- return a shallower overview first
- force branch narrowing by `node_id`

## 5. Persistent Asset Path Matters

Inline image evidence must resolve from a persistent knowledge document asset path.

Do not rely on thread-temporary paths for citations or markdown images.

Otherwise:

- image rendering becomes flaky
- preview links break across sessions
- repeated citation clicks can fail to relocate correctly

## 6. Word Preview Cannot Be Treated Like PDF Preview

Word documents do not naturally support stable page jump like PDF.

Fallback strategy should be explicit:

- preview the converted representation
- or jump by canonical markdown heading / mapped anchor

Do not pretend page-accurate jump exists when it does not.

## 7. Storage Ref Should Be Treated As Opaque

Knowledge-base file refs may be:

- local relative paths
- `s3://...` object refs

Do not write new code that assumes all `storage_ref` values are filesystem paths.

## 8. Deep Questions Are Required

Shallow questions can hide bad retrieval quality.

At least one test question should require:

- branch narrowing
- evidence expansion
- exact source confirmation

Otherwise the agent may look correct while still failing real usage.
