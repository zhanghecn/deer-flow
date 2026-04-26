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

- `107 passed, 1 warning`

Focused retry after test lint cleanup:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run pytest ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py -q'
```

Result:

- `61 passed, 1 warning`

Lint:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run ruff check tests/test_summarization_config.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_factory.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py'
```

Result:

- `All checks passed`

Import-order lint:

```bash
docker compose -f docker/docker-compose.yaml exec -T langgraph sh -lc \
  'cd /workspace/backend/agents && UV_PROJECT_ENVIRONMENT=/openagents-home/dev-cache/agents-venv uv run ruff check --select I tests/test_summarization_config.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_factory.py ../deepagents/libs/deepagents/tests/unit_tests/middleware/test_summarization_middleware.py ../deepagents/libs/deepagents/deepagents/middleware/summarization.py'
```

Result:

- `All checks passed`

Known lint note:

- Full lint on `deepagents/middleware/summarization.py` still reports existing
  optional-runtime import and defensive broad-catch rules (`PLC0415`, `BLE001`,
  `ANN401`). Those were present around the OpenAgents optional config bridge and
  are not new to this compaction fix.

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
