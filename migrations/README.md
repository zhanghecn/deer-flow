# Migration Baseline

These SQL files are applied manually.
Gateway and docker compose no longer execute repository migrations automatically.

The active baseline is intentionally squashed into two files:

- `001_init.up.sql`
- `002_seed_data.up.sql`

`001_init.up.sql` contains the full current gateway-owned schema:

- `users`
- `api_tokens`
- `public_api_invocations`
- `public_api_artifacts`
- `public_api_input_files`
- `models`
- `thread_bindings`
- `agent_traces`
- `agent_trace_events`
- `knowledge_bases`
- `knowledge_documents`
- `knowledge_document_nodes`
- `knowledge_thread_bindings`
- `knowledge_build_jobs`
- `knowledge_build_events`

Intentionally absent by design:

- runtime checkpoint tables such as `checkpoints`, `checkpoint_blobs`, and related runtime-owned state
- legacy `agents`, `skills`, and `agent_skills` tables

Agent and skill definitions remain filesystem archives under `.openagents/`,
not database rows.

`002_seed_data.up.sql` contains only deterministic bootstrap data:

- the current `models` catalog, synchronized from the live `openagents` database
- the default admin user:
  - account: `admin`
  - password: `admin123`
  - email: `admin@163.com`

Runtime/user-generated rows in `users`, thread tables, observability tables, and
knowledge-base tables are intentionally excluded from migrations.

Historical stepwise migrations have been squashed into the current `001` / `002`
pair. Databases that were created from the historical chain should be kept as-is
or rebuilt before re-bootstrap; do not expect the new baseline files to backfill
a partially migrated older database.
