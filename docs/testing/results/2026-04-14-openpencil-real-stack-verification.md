# OpenPencil Real-Stack Verification

Date: 2026-04-14

## Scope

Verify the Deer Flow + OpenPencil integration on the current-code production-style
Docker stack instead of relying only on unit/integration tests.

Verified stack:

- `docker/docker-compose-prod.yaml`
- `http://127.0.0.1:8083`
- services rebuilt/recreated during validation:
  - `nginx`
  - `openpencil`
  - `langgraph`

## Threads Used

- Primary verification thread:
  - `295186d8-3543-4a4a-a890-2bc1039bd8cc`
- Secondary design-agent thread checked for empty-state behavior:
  - `d48f3c7c-6483-4e40-a1cc-7ef0f62e63a5`

## Real-Stack Results

### 1. Current code reached the browser

Initial browser verification showed the old right-dock state (`Preview / Files / Runtime`)
without the new `Design` surface. After rebuilding `nginx`, the browser showed:

- `Preview`
- `Design`
- `Files`
- `Runtime`

This confirmed the browser had switched from stale assets to current code.

### 2. OpenPencil bridge container also needed refresh

After only rebuilding `nginx`, the OpenPencil popup opened but the Deer Flow
thread page received no `openpencil-host-bridge` messages.

After `openpencil` was force-recreated, the thread page received real bridge
events:

- `design.selection.changed`
- `design.document.dirty`
- `design.document.loaded`

The thread-side `Design` surface then moved from `Loading` to `Ready`.

### 3. Real OpenPencil session bootstrap works

The real popup URL included the expected Deer Flow session contract:

- `design_token`
- `design_thread_id`
- `design_session_id`
- `design_session_generation`
- `design_revision`
- `design_target_path`

### 4. Real agent-driven design edit works

A real chat turn was submitted on thread
`295186d8-3543-4a4a-a890-2bc1039bd8cc` instructing the agent to rename the
root design frame to `REALTIME_AGENT_PROBE_2`.

Observed evidence:

- Assistant reply contained `REALTIME_AGENT_PROBE_OK_2`
- `canvas.op` file hash changed
- Deer Flow `Design` panel stayed visible and reported `已就绪`
- The panel showed the new revision hash

Hash evidence:

- before: `90eccb5ec8e53a3142c1f5d17862cbd327091b3211f686e440f5362e14f649fa`
- after: `6d87014f9199d39ccf0da1af29bd7d765375a77ecf4a11a319f8044412a8f6f2`

### 5. Empty-state behavior is correct

The design-agent thread `d48f3c7c-6483-4e40-a1cc-7ef0f62e63a5` currently has
no output artifacts via the thread artifact listing API, but the real browser
still shows:

- `Design` tab present
- empty-state copy
- `Open design editor` CTA

This confirms the thread-local design surface remains reachable even before a
design session is active.

## Real Bug Found

### `.op` corruption during real `edit_file`

During a real agent-driven edit, the `.op` document became invalid with the
error:

```text
invalid design document json: invalid character '{' looking for beginning of object key string
```

Inspection showed the file had been turned into:

- one valid JSON document
- followed by a duplicated trailing fragment

Root cause:

- `backend/agents/src/runtime_backends/design_file_guard.py`
- the `.edit()` path validated the full normalized candidate document correctly
- but then passed that full normalized candidate as the replacement for the
  matched `old_string`
- this spliced a whole JSON document into a substring replacement instead of
  replacing the full file

Fix:

- replace the entire existing file content with the normalized candidate after
  validation
- added regression coverage in:
  - `backend/agents/tests/test_runtime_backend_design_file_guard.py`

After rebuilding `langgraph`, the same real workflow succeeded without
corrupting `canvas.op`.

## Operational Notes

- In this compose setup, `openpencil` is source-mounted and runs its own build
  at container startup.
- That means `docker compose ... up -d --build nginx` is not enough to refresh
  OpenPencil code.
- To pick up OpenPencil bridge changes on the real stack, `openpencil` must be
  recreated explicitly:

```bash
docker compose -f docker/docker-compose-prod.yaml up -d --force-recreate openpencil
```

## Remaining Gaps

- Cross-browser multi-user editing was not tested.
- Two simultaneously open OpenPencil tabs were not validated end-to-end with a
  final real save/reload observation because the main correctness issue found
  during real testing was the runtime `edit_file` corruption bug above.
- OpenPencil Vitest still emits its existing post-pass hanging-process warning,
  although the tests pass and exit `0`.

## Commits Associated With This Verification

Deer Flow:

- `99d7a61b` Keep design sessions observable and safe inside Deer Flow
- `f2edc32c` Document and wire the current-source OpenPencil compose path
- `33accc92` Record the finalized Manus alignment artifacts

OpenPencil:

- `4df803e` Keep Deer Flow bridge sessions synchronized in OpenPencil
