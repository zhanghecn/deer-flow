# Knowledge Base Test Spec

## Scope

This spec is for any change involving:

- knowledge-base ingestion
- PageTree / evidence retrieval
- citations / preview jump
- inline image evidence
- knowledge-base selector and management UI
- object storage / filesystem storage refs

## Required Test Phases

### 1. Code-Level Baseline

Before browser testing:

1. Run the relevant unit and integration tests.
2. Verify any new storage or preview contract with at least one focused smoke test.
3. If object storage is enabled, verify read and write against the real object store.

### 2. Headed Browser User Test

Use a headed browser against:

- `http://localhost:3000`
- account: `admin`
- password: `admin123`

Required user-flow coverage:

1. Log in successfully.
2. Open knowledge-base management from the real user-visible entry.
3. Verify create / upload flow for at least one document.
4. Verify build state transitions:
   - queued
   - processing
   - ready or ready_degraded
   - error path when relevant
5. Verify preview opens correctly.
6. Verify clicking a citation or source jumps to the expected preview location.
7. Verify delete and delete-all flows when the task touches management behavior.

### 3. Agent Usage Test

Still from the real app flow:

1. Start or open a chat that can use the knowledge base.
2. Confirm the knowledge base is actually attached or selected.
3. Ask at least one deep question, not only title-level or obvious questions.
4. Verify the answer:
   - used the knowledge tools instead of bypassing them
   - contains grounded citations
   - citations match the returned source
   - image evidence appears naturally when the document meaning depends on images

### 4. Internal Audit Test

Use:

- `http://localhost:5173`

Required audit coverage:

1. Inspect the agent run trace.
2. Confirm the tool path is reasonable:
   - `list_knowledge_documents`
   - `get_document_tree`
   - `get_document_evidence`
3. Confirm it did not regress to broad spill behavior without narrowing.
4. Confirm the final answer matches the evidence bundle used in the same turn.
5. If behavior is wrong, record the exact failure mode rather than guessing.

### 5. Current-Code Stack Verification

If `3000 / 8001 / 2024` are long-running processes, do not assume they are serving the current working tree.

When backend, ingestion, or storage code changed:

1. Verify whether the real app stack was restarted.
2. If not, run a sidecar stack on separate ports and verify the new code there.
3. Record clearly which environment each test result came from.

## Minimum Document Matrix

When the task touches ingestion or preview:

- `markdown`
- `pdf`
- `docx` or `doc`

When the task touches image evidence:

- use at least one document that actually contains meaningful images

## Required Result Recording

Every completed test pass should record:

- test date and environment
- exact URLs used
- account used
- document names used
- whether the stack was current-code or long-running shared dev stack
- result of browser flow
- result of 5173 internal audit
- known gaps
