#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
ENV_EXAMPLE="$DOCKER_DIR/.env.example"
ENV_FILE="$DOCKER_DIR/.env"
FORCE=0

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-deploy.sh [--force]

Prepares the self-contained production Docker directory:
  - docker/.env with generated secrets
  - docker/config.yaml and docker/gateway.yaml deployment copies
  - docker/data/openagents, docker/data/postgres, docker/data/minio

Then start with:
  cd docker
  docker compose -f docker-compose-prod.yaml up -d
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
    [ -f "$ENV_EXAMPLE" ] || fail "Missing template: $ENV_EXAMPLE"

    info "Preparing docker production deployment directory"
    mkdir -p "$DOCKER_DIR/data/openagents" "$DOCKER_DIR/data/postgres" "$DOCKER_DIR/data/minio"

    if [ -f "$ENV_FILE" ] && [ "$FORCE" -ne 1 ]; then
        warn "Keeping existing $ENV_FILE; pass --force to regenerate secrets"
    else
        if [ "$FORCE" -ne 1 ] && { directory_has_files "$DOCKER_DIR/data/postgres" || directory_has_files "$DOCKER_DIR/data/minio"; }; then
            fail "Existing PostgreSQL/MinIO data found but docker/.env is missing. Restore the original docker/.env, or pass --force only for a fresh/reset deployment."
        fi
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        replace_env "OPENAGENTS_POSTGRES_PASSWORD" "$(secret)"
        replace_env "OPENAGENTS_MINIO_ROOT_PASSWORD" "$(secret)"
        replace_env "KNOWLEDGE_S3_SECRET_KEY" "$(grep '^OPENAGENTS_MINIO_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
        replace_env "JWT_SECRET" "$(secret)"
        chmod 600 "$ENV_FILE"
        success "Generated docker/.env with production secrets"
    fi

    copy_if_available "$PROJECT_ROOT/config.yaml" "$DOCKER_DIR/config.yaml"
    copy_if_available "$PROJECT_ROOT/backend/gateway/gateway.yaml" "$DOCKER_DIR/gateway.yaml"

    success "Created docker/data/openagents, docker/data/postgres, docker/data/minio"
    echo ""
    echo "Next steps:"
    echo "  cd docker"
    echo "  docker compose -f docker-compose-prod.yaml up -d"
    echo ""
    echo "First deployment still needs the SQL baseline applied once:"
    echo "  docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < ../migrations/001_init.up.sql"
    echo "  docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < ../migrations/002_seed_data.up.sql"
}

main "$@"
