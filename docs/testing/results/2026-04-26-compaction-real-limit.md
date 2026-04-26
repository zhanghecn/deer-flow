# Real Context-Limit Compaction Test

Date: 2026-04-26

## Scope

Validate automatic conversation compaction under a long `/v1/turns` thread that
is complex enough to reach the real model pressure path, then verify that the
post-compaction agent can continue without tool calls and still remember early
knowledge-base facts.

## Environment

- Stack entrypoint: `docker/docker-compose.yaml`
- Gateway: `http://127.0.0.1:8001`
- Demo chat: `http://127.0.0.1:8084/chat`
- Admin observability: `http://127.0.0.1:8081/observability`
- Agent: `support-cases-http-demo`
- Model config observed through admin API: `GLM-5.1.max_input_tokens=200000`

## Code-Level Verification

Executed in Docker:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run pytest tests/test_summarization_config.py tests/test_context_window_middleware.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_factory.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_compact_tool.py -q'
```

Result:

- `118 passed, 1 warning`

Focused retry after test lint cleanup:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run pytest ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_compact_tool.py -q'
```

Result:

- `104 passed, 1 warning`

Lint:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run ruff check ../deepagents/libs/deepagents/deepagents/middleware/summarization.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_compact_tool.py'
```

Result:

- `All checks passed`

Import-order lint:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run ruff check --select I ../deepagents/libs/deepagents/deepagents/middleware/summarization.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_compact_tool.py'
```

Result:

- `All checks passed`

## Real `/v1/turns` Compaction Run

Test shape:

- Created a temporary public API token scoped to `support-cases-http-demo`.
- Turn 1 performed real knowledge-base retrieval for:
  - `甲辰` total hits
  - `戊辰` total hits
  - `甲辰 / 庚午 / 癸亥 / 车祸+死亡` case combination
- Appended 21 smaller pressure turns in the same thread. Each pressure turn
  explicitly requested no tools and returned only `ACK-*`.
- Final turn requested a no-tool memory answer after compaction.
- Temporary API token was revoked after the test.

Final thread:

- `d5890a87-d74f-4c77-8f8d-2e8659698cb5`

Compaction trigger turn:

- Turn ID: `resp_2bc4cf3147814c409070a5f3c6815397`
- Trace ID: `70d3ccb5-a9c7-4fe6-b10a-d391657792df`
- `summary_applied=true`
- `summary_count=1`
- `max_input_tokens=200000`
- `approx_input_tokens=76791`
- `usage_ratio=0.383955`
- `approx_input_tokens_after_summary=22241`
- `usage_ratio_after_summary=0.111205`
- Summary history file:
  `.openagents/threads/d5890a87-d74f-4c77-8f8d-2e8659698cb5/user-data/outputs/.conversation_history/d5890a87-d74f-4c77-8f8d-2e8659698cb5.md`
- Summary history size: `590288` bytes
- Summary history contains the early anchors `甲辰`, `戊辰`, `760`, and `921`.

Post-compaction memory check:

- Turn ID: `resp_bedb4549b2c4425682392c329fc8dcf5`
- Trace ID: `b3d77664-2ce4-41f7-8769-82fab30b2e8a`
- `tool_event_count=0`
- `approx_input_tokens=22287`
- `summary_count=1`
- Final answer remembered:
  - `甲辰=760`
  - `戊辰=921`
  - `Case67 = 案例455 = 案例70` as the same accident's immediate-death case
  - `Case68 = 案例456 = 案例71` as the paired three-days-later death case

## Failure Reproduced And Fixed

Before the provider-overflow fix, a long thread failed at the real model path:

- Thread: `639b74ed-88b0-4936-990d-1666de9265b0`
- Failure: `stop_reason=model_context_window_exceeded`
- Runtime error surfaced as:
  `Model produced no visible assistant response after recovery retry`
- At that point telemetry still showed `max_input_tokens=200000` and
  `usage_ratio=0.265355`, so the error did not arrive as LangChain's standard
  `ContextOverflowError`.

Fix validated:

- Provider-specific `RuntimeError(... model_context_window_exceeded ...)` now
  enters the same compaction fallback path as `ContextOverflowError`.
- The successful long-thread run above reached the real pressure path, applied
  summary, then continued to a no-tool final answer.

## Follow-Up Regression Run

After the initial pass, a more severe real thread exposed three additional
failure modes:

- The summary model can return an empty `<summary></summary>` without raising.
  Persisting that empty summary erased early facts for later turns.
- A poisoned prior summary event could produce a cumulative `cutoff_index`
  larger than the raw message count, causing replay to drop the latest user
  message and feed only the old summary to the model.
- Extractive overflow fallback could preserve repeated historical pressure
  instructions so strongly that a later no-tool question was answered with the
  old `ACK` instead of the requested facts.

Fixes validated in Docker:

- Empty summaries are rejected before state update and replaced with a
  deterministic extractive fallback.
- Empty or out-of-range `_summarization_event` values are treated as invalid
  during replay and during the next event's cutoff calculation.
- Repeated historical text is collapsed before extractive clipping, and the
  fallback summary explicitly marks historical Human/AI/Tool text as evidence
  rather than instructions that override the latest user message.

Real pressure evidence:

- Thread: `a42d23ea-bc07-4c1e-ab70-4fd99916f428`
- Seed turn: `resp_723859ef3f1b4c939d9ef69f8d325e1e`
- Pressure turn: `resp_00c049498a0944beab06d24e59b17438`
- Pressure result: `turn.completed`, `tool_count=0`,
  output `ACK-PRESSURE-REAL-V7`
- Immediate follow-up turn: `resp_2b78bec70c4c42a8909c1820f0415f3d`
- Follow-up result: `turn.completed`, `tool_count=0`
- Follow-up answer:
  `甲辰命中频次=109+48=157次；子平总数=963；盲派总数=423；刚才压力turn要求回复的ACK是ACK-PRESSURE-REAL-V7。`
- Post-restart verification turn: `resp_87a3c3ee40994b0e8b0bdc5dc593e0f9`
- Post-restart result: `turn.completed`, `tool_count=0`, same facts retained.

State audit after the pressure run:

- `message_count=87`
- `_summarization_event.cutoff_index=84`
- `cutoff_valid=true`
- `summary_len=9315`
- summary contains `previous historical segment repeated ...`
- summary contains `ACK-PRESSURE-REAL-V7`

## Browser Verification

Demo chat:

- URL: `http://127.0.0.1:8084/chat`
- Page title: `AI 助手`
- Visible body includes:
  `你好，我是 support-cases-http-demo 助手`

Admin observability:

- URL: `http://127.0.0.1:8081/observability`
- Browser page showed recent traces for thread
  `d5890a87-d74f-4c77-8f8d-2e8659698cb5`.
- The visible trace list included:
  - final no-tool memory check
  - pressure turn 21
  - earlier pressure turns with large token counts

## Conclusion

The Docker stack now passes a real long-thread compaction test:

- complex knowledge-base facts are collected before compaction
- many-turn pressure reaches the runtime compaction path
- provider-specific context-window stop reasons no longer bypass compaction
- full evicted transcript is summarized instead of tail-trimmed
- post-compaction answer retains early facts without calling tools
