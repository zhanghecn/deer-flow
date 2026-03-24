# Plan Mode with TodoList Middleware

This document describes the current todo-list behavior in OpenAgents and the
legacy `is_plan_mode` runtime flag.

## Overview

Deep Agents already includes `TodoListMiddleware` in the default middleware
stack for the main agent and subagents. That means `write_todos` is generally
available without OpenAgents adding a separate custom todo middleware.

OpenAgents now focuses its custom middleware layer on product-specific behavior
such as uploads, authoring guards, title persistence, response recovery, and
telemetry.

## Runtime Compatibility

`is_plan_mode` is still accepted in `RunnableConfig.configurable` for backward
compatibility with older callers, but the current graph assembly does not
add/remove `TodoListMiddleware` based on that flag.

```python
from langchain_core.runnables import RunnableConfig
from src.agents.lead_agent.agent import make_lead_agent

config = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # Legacy compatibility field
    }
)

agent = make_lead_agent(config)
```

## How It Works

1. `make_lead_agent(config)` resolves model, backend, and runtime context.
2. `create_deep_agent(...)` builds the default Deep Agents middleware stack.
3. That default stack already includes `TodoListMiddleware`,
   `FilesystemMiddleware`, `SummarizationMiddleware`, and
   `PatchToolCallsMiddleware`.
4. OpenAgents appends only its own runtime-specific middlewares through
   `_build_openagents_middlewares(...)`.
5. The agent can use `write_todos` whenever explicit task tracking helps the
   user experience.

## Architecture

```text
make_lead_agent(config)
  |
  +-> create_deep_agent(...)
        |
        +-> Deep Agents built-ins
        |     - TodoListMiddleware
        |     - FilesystemMiddleware
        |     - SummarizationMiddleware
        |     - PatchToolCallsMiddleware
        |
        +-> OpenAgents middleware layer
              - ArtifactsMiddleware
              - AuthoringGuardMiddleware
              - RuntimeCommandMiddleware
              - UploadsMiddleware
              - TitleMiddleware
              - recovery / clarification middlewares
              - ContextWindowMiddleware
              - ViewImageMiddleware (vision models only)
```

## Usage Guidance

Use the todo list when the task has multiple distinct steps, when progress needs
to be visible to the user, or when work must be coordinated across several
actions.

Skip it for trivial one-shot requests, short conversational answers, or tasks
where a plan would add overhead without improving execution quality.

## Notes

- `is_plan_mode` should be treated as a compatibility input, not the source of
  truth for whether todo support exists.
- If you need a true opt-in planning mode in the future, implement it as an
  explicit policy layer on top of Deep Agents instead of reintroducing a custom
  todo middleware.
