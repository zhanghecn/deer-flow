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
DOCKER_NETWORK="${OPENAGENTS_DOCKER_NETWORK:-openagents}"
MODEL_GATEWAY_CONTAINER="${MODEL_GATEWAY_CONTAINER:-}"
MODEL_GATEWAY_ALIAS="${MODEL_GATEWAY_ALIAS:-model-gateway}"

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-deploy.sh [--force] [--start]

Prepares the self-contained production deploy directory:
  - deploy/.env with generated secrets
  - deploy/config.yaml and deploy/gateway.yaml deployment copies
  - deploy/migrations copied from reviewed root SQL
  - deploy/data/openagents, deploy/data/postgres, deploy/data/minio

Then start with:
  cd deploy
  docker compose -f docker-compose.yml up -d

Or let the script perform the first-run-safe startup sequence:
  scripts/docker-deploy.sh --start

To make an existing New API container reachable from OpenAgents:
  MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F scripts/docker-deploy.sh
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

env_value() {
    local key="$1"
    local line=""
    if [ ! -f "$ENV_FILE" ]; then
        return
    fi
    line="$(grep "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
    [ -n "$line" ] || return
    printf '%s\n' "${line#*=}"
}

ensure_env_value() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
        return
    fi
    replace_env "$key" "$value"
}

normalize_existing_env() {
    local old_repository old_tag

    # Older deploy/.env files used one repository plus service-prefixed tags
    # such as gateway-latest. The canonical contract now keeps service identity
    # in the image name and uses one OPENAGENTS_VERSION for every image.
    old_repository="$(env_value OPENAGENTS_IMAGE_REPOSITORY || true)"
    old_tag="$(env_value OPENAGENTS_IMAGE_TAG || true)"
    ensure_env_value "OPENAGENTS_IMAGE_PREFIX" "${old_repository:-zhangxuan2/openagents}"
    ensure_env_value "OPENAGENTS_VERSION" "${old_tag:-latest}"
    ensure_env_value "OPENAGENTS_MIGRATIONS_DIR" "./migrations"
    ensure_env_value "OPENAGENTS_DOCKER_NETWORK" "$DOCKER_NETWORK"

    # Existing deploy env files are preserved to avoid rotating production
    # secrets. Add newly supported optional media keys as empty operator
    # placeholders so sandbox.environment references are visible after upgrade.
    ensure_env_value "ARK_API_KEY" ""
    ensure_env_value "ARK_API_BASE_URL" ""
    ensure_env_value "ARK_IMAGE_MODEL" ""
    ensure_env_value "ARK_IMAGE_SIZE" ""
    ensure_env_value "VOLCENGINE_API_KEY" ""
    ensure_env_value "VOLCENGINE_API_BASE_URL" ""
    ensure_env_value "VOLCENGINE_IMAGE_MODEL" ""
    ensure_env_value "VOLCENGINE_IMAGE_SIZE" ""
    ensure_env_value "VOLCENGINE_TTS_APPID" ""
    ensure_env_value "VOLCENGINE_TTS_ACCESS_TOKEN" ""
    ensure_env_value "VOLCENGINE_TTS_CLUSTER" ""
}

refresh_env_backed_settings() {
    local configured_network

    configured_network="$(env_value OPENAGENTS_DOCKER_NETWORK || true)"
    if [ -n "$configured_network" ]; then
        # Compose reads deploy/.env, so the helper must create/attach the same
        # external network that compose will later require.
        DOCKER_NETWORK="$configured_network"
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

sync_migrations() {
    local target="$DEPLOY_DIR/migrations"

    # The compose `migrate` service only reads deploy/migrations. Replacing the
    # generated copy keeps deploy/ self-contained while root migrations remain
    # the reviewed source of truth for code review.
    rm -rf "$target"
    mkdir -p "$target"
    cp "$PROJECT_ROOT"/migrations/*.up.sql "$target"/
    cp "$PROJECT_ROOT/migrations/run.sh" "$target/run.sh"
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
        # deploy/docker-compose.yml declares the bridge as external so the same
        # network can also hold a pre-existing New API container alias.
        info "Using existing Docker network: $DOCKER_NETWORK"
        return
    fi

    info "Creating Docker network: $DOCKER_NETWORK"
    docker network create "$DOCKER_NETWORK" >/dev/null
}

attach_model_gateway_if_requested() {
    if [ -z "$MODEL_GATEWAY_CONTAINER" ]; then
        return
    fi

    docker inspect "$MODEL_GATEWAY_CONTAINER" >/dev/null 2>&1 || fail "Model gateway container not found: $MODEL_GATEWAY_CONTAINER"

    if docker inspect "$MODEL_GATEWAY_CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$DOCKER_NETWORK\""; then
        info "Model gateway is already attached to $DOCKER_NETWORK"
        return
    fi

    # New API remains outside this compose file; this attach step gives the
    # OpenAgents deploy network a stable DNS name without starting another
    # gateway container.
    docker network connect --alias "$MODEL_GATEWAY_ALIAS" "$DOCKER_NETWORK" "$MODEL_GATEWAY_CONTAINER"
    success "Attached $MODEL_GATEWAY_CONTAINER to $DOCKER_NETWORK as $MODEL_GATEWAY_ALIAS"
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
    [ -f "$DEPLOY_DIR/docker-compose.yml" ] || fail "Missing canonical deploy compose: $DEPLOY_DIR/docker-compose.yml"

    [ -f "$ENV_EXAMPLE" ] || fail "Missing template: $ENV_EXAMPLE"

    if [ -f "$ENV_FILE" ] && [ "$FORCE" -ne 1 ]; then
        warn "Keeping existing $ENV_FILE; pass --force to regenerate secrets"
        normalize_existing_env
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
        normalize_existing_env
        success "Generated deploy/.env with production secrets"
    fi

    copy_if_available "$PROJECT_ROOT/config.yaml" "$DEPLOY_DIR/config.yaml"
    copy_if_available "$PROJECT_ROOT/backend/gateway/gateway.yaml" "$DEPLOY_DIR/gateway.yaml"
    sync_runtime_asset_dir commands
    sync_runtime_asset_dir system
    sync_migrations
    refresh_env_backed_settings
    ensure_docker_network
    attach_model_gateway_if_requested

    success "Created deploy/data/openagents, deploy/data/postgres, deploy/data/minio"
    success "Synced .openagents/commands and .openagents/system into deploy/data/openagents"
    success "Synced reviewed SQL migrations into deploy/migrations"
    echo ""
    echo "Next steps:"
    echo "  cd deploy"
    echo "  docker compose -f docker-compose.yml up -d"
    echo "  # New API sync URL inside containers: http://${MODEL_GATEWAY_ALIAS}:3000"

    if [ "$START" -eq 1 ]; then
        echo ""
        info "Starting production stack from deploy/docker-compose.yml"
        compose up -d
        success "Production stack is started; the migrate service gates gateway/langgraph startup"
    fi
}

main "$@"
