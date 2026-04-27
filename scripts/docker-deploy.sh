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

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-deploy.sh [--force]

Prepares the self-contained production deploy directory:
  - deploy/docker-compose.yml
  - deploy/.env with generated secrets
  - deploy/config.yaml and deploy/gateway.yaml deployment copies
  - deploy/data/openagents, deploy/data/postgres, deploy/data/minio

Then start with:
  cd deploy
  docker compose -f docker-compose.yml up -d
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

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --force)
                FORCE=1
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
}

main "$@"
