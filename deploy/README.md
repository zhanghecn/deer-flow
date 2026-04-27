# Deploy Directory

`scripts/docker-deploy.sh` prepares this directory for production-style Docker
deployments. Keep generated secrets, copied config, compose output, and
persistent data here instead of mixing them into `docker/`.

Tracked files:

- `.env.example` - template used to generate `deploy/.env`
- `README.md` - this operator note

Generated files, ignored by git:

- `docker-compose.yml` - copied from `docker/docker-compose-prod.yaml`
- `.env` - generated deployment secrets
- `config.yaml` - deployment copy of root `config.yaml`
- `gateway.yaml` - deployment copy of `backend/gateway/gateway.yaml`
- `data/` - OpenAgents runtime, PostgreSQL, and MinIO data

Typical first run:

```bash
./scripts/docker-deploy.sh --start
```

`--start` brings PostgreSQL up first, applies the SQL baseline if the database
is empty, then starts the full stack. If you prefer to run the steps manually,
apply the initial SQL baseline once from the repository root after PostgreSQL
is running:

```bash
docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < migrations/001_init.up.sql
docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < migrations/002_seed_data.up.sql
```
