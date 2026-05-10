# OpenAgents SQL Migrations

`migrations/` is the reviewed SQL source. Production deploys do not ask gateway
to run migrations; `deploy/docker-compose.yml` runs the dedicated one-shot
`migrate` service before `gateway` and `langgraph` start.

Current baseline:

- `001_init.up.sql` — gateway-owned schema plus the migration ledger table.
- `002_data.up.sql` — deterministic bootstrap data plus idempotent data repair.
- `run.sh` — idempotent runner used by the compose `migrate` service.

`001_init.up.sql` covers gateway-owned tables such as:

- `users`, `api_tokens`, `models`
- `thread_bindings`
- `agent_traces`, `agent_trace_events`
- knowledge-base tables and build-event tables
- public API invocation/artifact/input-file tables

Intentionally absent:

- runtime checkpoint tables such as `checkpoints` and `checkpoint_blobs`
- legacy `agents`, `skills`, and `agent_skills` tables

Agent and skill definitions remain filesystem archives under `.openagents/`,
not database rows.

`002_data.up.sql` seeds the default administrator:

```text
account: admin
password: admin123
email: admin@163.com
```

Model rows are not seeded with repository SQL because the correct model catalog
belongs to the operator's New API gateway. After New API is attached to the
deploy network, sync models from the admin console with:

```text
http://model-gateway:3000
```

The same data SQL also contains safe repair statements for historical New API
rows, so a deploy can converge old synced model rows without keeping a third
baseline SQL file.

## Adding A Migration

1. Add a new reviewed SQL file named `NNN_short_name.up.sql`.
2. Wrap the SQL in `BEGIN; ... COMMIT;`.
3. Do not edit a migration that has already run in production; the runner checks
   `openagents_schema_migrations.checksum` and fails on drift.
4. Run `./scripts/docker-deploy.sh` so `deploy/migrations/` receives the new SQL.
5. Apply it with `cd deploy && docker compose run --rm migrate`, or let
   `scripts/docker-release.sh deploy --scope gateway|app|all` run it.

The runner can adopt older databases that already contain the complete schema
but lack `openagents_schema_migrations`. It records only `001_init.up.sql`,
then lets `002_data.up.sql` run so idempotent seed/repair statements still
converge. It also recognizes the older `002_seed_data.up.sql` ledger name so
existing internal deploys can move to the two-file baseline. Partial schemas
fail loudly and must be inspected manually.
