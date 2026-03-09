# Migration Baseline

This directory is split into schema + data migrations:

- `001_init.up.sql`
- `002_seed_data.up.sql`

Included schema:

- `users`
- `api_tokens`
- `agents` (includes `mcp_servers`)
- `skills`
- `agent_skills`
- `models`
- `thread_bindings`
- `agent_traces`
- `agent_trace_events`
- `llm_provider_keys`

Included data in `002_seed_data.up.sql`:

- seeded `models` rows from historical `003_seed_models_from_apikeys` migration
- default admin user:
  - account: `admin`
  - password: `admin123`
  - email: `admin@163.com`

Removed as historical/legacy:

- `threads` local table

If your environment already has a migration version beyond this new baseline (`001` + `002`)
recorded in `schema_migrations`,
reset/rebuild the database or reconcile migration state before running `make migrate`.
