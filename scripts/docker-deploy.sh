#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
ENV_EXAMPLE="$DEPLOY_DIR/.env.example"
ENV_FILE="$DEPLOY_DIR/.env"
FORCE=0
START=0
DOCKER_NETWORK="${OPENAGENTS_DOCKER_NETWORK:-openagents-prod_openagents}"

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-deploy.sh [--force] [--start]

Prepares the self-contained production deploy directory:
  - deploy/docker-compose.yml
  - deploy/.env with generated secrets
  - deploy/config.yaml and deploy/gateway.yaml deployment copies
  - deploy/data/openagents, deploy/data/postgres, deploy/data/minio

Then start with:
  cd deploy
  docker compose -f docker-compose.yml up -d

Or let the script perform the first-run-safe startup sequence:
  scripts/docker-deploy.sh --start
EOF
}

secret() {
    openssl rand -hex 32
}

replace_env() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

copy_if_available() {
    local source="$1"
    local target="$2"
    if [ -f "$target" ] && [ "$FORCE" -ne 1 ]; then
        warn "Keeping existing $target"
        return
    fi
    [ -f "$source" ] || fail "Missing source config: $source"
    cp "$source" "$target"
}

sync_runtime_asset_dir() {
    local name="$1"
    local source="$PROJECT_ROOT/.openagents/$name"
    local target="$DEPLOY_DIR/data/openagents/$name"

    [ -d "$source" ] || fail "Missing runtime asset directory: $source"

    # commands/ and system/ are bundled runtime assets, not user-authored data.
    # Replace them on deploy preparation so a fresh deploy/data tree has the
    # same built-in commands, system agents, and system skills as the repo.
    rm -rf "$target"
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
}

directory_has_files() {
    local path="$1"
    [ -d "$path" ] || return 1
    find "$path" -mindepth 1 -print -quit | grep -q .
}

compose() {
    (cd "$DEPLOY_DIR" && docker compose -f docker-compose.yml "$@")
}

ensure_docker_network() {
    if docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
        # The production compose declares this as external so existing networks
        # with older Compose labels can be reused instead of failing startup.
        info "Using existing Docker network: $DOCKER_NETWORK"
        return
    fi

    info "Creating Docker network: $DOCKER_NETWORK"
    docker network create "$DOCKER_NETWORK" >/dev/null
}

postgres_container() {
    compose ps -q postgres | head -n 1
}

wait_for_postgres() {
    local container_id=""
    local deadline
    deadline=$((SECONDS + 90))

    while [ "$SECONDS" -lt "$deadline" ]; do
        container_id="$(postgres_container)"
        if [ -n "$container_id" ] && docker exec "$container_id" pg_isready -U openagents -d openagents >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done

    fail "PostgreSQL did not become ready within 90 seconds"
}

schema_state() {
    local container_id="$1"

    docker exec -i "$container_id" psql -U openagents -d openagents -tAc \
        "select count(*) from pg_tables where schemaname='public' and tablename in ('models','knowledge_build_jobs','users');" |
        tr -d '[:space:]'
}

apply_baseline_sql_if_needed() {
    local container_id
    local table_count

    container_id="$(postgres_container)"
    [ -n "$container_id" ] || fail "PostgreSQL container is not running"

    table_count="$(schema_state "$container_id")"
    case "$table_count" in
        0)
            info "Applying SQL baseline into empty PostgreSQL database"
            # Baseline SQL is intentionally applied after PostgreSQL is healthy
            # and before gateway starts, because gateway fails fast if required
            # tables such as models and knowledge_build_jobs are absent.
            docker exec -i "$container_id" psql -U openagents -d openagents -v ON_ERROR_STOP=1 < "$PROJECT_ROOT/migrations/001_init.up.sql"
            docker exec -i "$container_id" psql -U openagents -d openagents -v ON_ERROR_STOP=1 < "$PROJECT_ROOT/migrations/002_seed_data.up.sql"
            ;;
        3)
            warn "PostgreSQL baseline tables already exist; skipping baseline SQL"
            ;;
        *)
            fail "PostgreSQL schema looks partial ($table_count/3 sentinel tables found). Inspect the database before applying migrations."
            ;;
    esac
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --force)
                FORCE=1
                shift
                ;;
            --start)
                START=1
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                fail "Unknown argument: $1"
                ;;
        esac
    done
}

main() {
    parse_args "$@"

    command -v openssl >/dev/null 2>&1 || fail "openssl is required to generate secrets"

    info "Preparing deploy production directory"
    mkdir -p "$DEPLOY_DIR/data/openagents" "$DEPLOY_DIR/data/postgres" "$DEPLOY_DIR/data/minio"
    cp "$PROJECT_ROOT/docker/docker-compose-prod.yaml" "$DEPLOY_DIR/docker-compose.yml"

    [ -f "$ENV_EXAMPLE" ] || fail "Missing template: $ENV_EXAMPLE"

    if [ -f "$ENV_FILE" ] && [ "$FORCE" -ne 1 ]; then
        warn "Keeping existing $ENV_FILE; pass --force to regenerate secrets"
    else
        if [ "$FORCE" -ne 1 ] && { directory_has_files "$DEPLOY_DIR/data/postgres" || directory_has_files "$DEPLOY_DIR/data/minio"; }; then
            fail "Existing PostgreSQL/MinIO data found but deploy/.env is missing. Restore the original deploy/.env, or pass --force only for a fresh/reset deployment."
        fi
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        replace_env "OPENAGENTS_POSTGRES_PASSWORD" "$(secret)"
        replace_env "OPENAGENTS_MINIO_ROOT_PASSWORD" "$(secret)"
        replace_env "KNOWLEDGE_S3_SECRET_KEY" "$(grep '^OPENAGENTS_MINIO_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
        replace_env "JWT_SECRET" "$(secret)"
        chmod 600 "$ENV_FILE"
        success "Generated deploy/.env with production secrets"
    fi

    copy_if_available "$PROJECT_ROOT/config.yaml" "$DEPLOY_DIR/config.yaml"
    copy_if_available "$PROJECT_ROOT/backend/gateway/gateway.yaml" "$DEPLOY_DIR/gateway.yaml"
    sync_runtime_asset_dir commands
    sync_runtime_asset_dir system
    ensure_docker_network

    success "Created deploy/data/openagents, deploy/data/postgres, deploy/data/minio"
    success "Synced .openagents/commands and .openagents/system into deploy/data/openagents"
    echo ""
    echo "Next steps:"
    echo "  cd deploy"
    echo "  docker compose -f docker-compose.yml up -d"
    echo ""
    echo "First deployment still needs the SQL baseline applied once:"
    echo "  docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < $PROJECT_ROOT/migrations/001_init.up.sql"
    echo "  docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < $PROJECT_ROOT/migrations/002_seed_data.up.sql"

    if [ "$START" -eq 1 ]; then
        echo ""
        info "Starting first-run-safe production stack"
        compose up -d postgres
        wait_for_postgres
        apply_baseline_sql_if_needed
        compose up -d
        success "Production stack is started from deploy/docker-compose.yml"
    fi
}

main "$@"
