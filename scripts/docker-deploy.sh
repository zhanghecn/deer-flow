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
START=1
DOCKER_NETWORK="${OPENAGENTS_DOCKER_NETWORK:-openagents}"
MODEL_GATEWAY_CONTAINER_FROM_ENV="${MODEL_GATEWAY_CONTAINER+x}"
MODEL_GATEWAY_ALIASES_FROM_ENV="${MODEL_GATEWAY_ALIASES+x}"
MODEL_GATEWAY_CONTAINER="${MODEL_GATEWAY_CONTAINER:-}"
MODEL_GATEWAY_ALIASES="${MODEL_GATEWAY_ALIASES:-model-gateway}"
PULL_IMAGES="${OPENAGENTS_PULL_IMAGES:-1}"
PULL_INFRA_IMAGES="${OPENAGENTS_PULL_INFRA_IMAGES:-0}"
OPENAGENTS_RUNTIME_SERVICES=(nginx gateway langgraph sandbox-aio onlyoffice)

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-deploy.sh [--force] [--prepare-only]

Purpose:
  - First install: generate deploy/.env secrets, prepare data directories,
    run SQL migrations through the compose migrate service, and start the stack.
  - Production update: refresh deploy assets, pull the configured images,
    run any new SQL migrations, and restart the stack.
  - Image publishing is separate: use scripts/docker-release.sh push --scope ...
    or push a v* tag for GitHub Actions.

Prepares and starts the self-contained production deploy directory:
  - deploy/.env with generated secrets
  - deploy/config.yaml and deploy/gateway.yaml deployment copies
  - deploy/migrations copied from reviewed root SQL
  - deploy/data/openagents, deploy/data/postgres, deploy/data/minio

The default behavior starts the production stack. Use --prepare-only when a
release script only needs to refresh generated deploy assets.
Set OPENAGENTS_PULL_IMAGES=0 to skip pulling images before startup.
By default, image pulls are limited to OpenAgents runtime services so Postgres
and MinIO are not upgraded/recreated during normal app updates. Set
OPENAGENTS_PULL_INFRA_IMAGES=1 to pull every compose image, including infra.
Deploy never builds images. Build or publish images explicitly with
scripts/docker-release.sh before running production deploy.

To make an existing OpenAI-compatible model gateway container reachable from OpenAgents:
  MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F scripts/docker-deploy.sh

Model gateway integration is explicit. If MODEL_GATEWAY_CONTAINER is omitted,
deploy does not search for or mutate external gateway containers. The container
is attached to the OpenAgents network with aliases from MODEL_GATEWAY_ALIASES,
defaulting to: model-gateway.
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
    ensure_env_value "OPENAGENTS_LOG_DIR" "./data/logs"
    ensure_env_value "OPENAGENTS_LOG_MAX_SIZE_MB" "100"
    ensure_env_value "OPENAGENTS_LOG_MAX_BACKUPS" "10"
    ensure_env_value "MODEL_GATEWAY_CONTAINER" ""
    ensure_env_value "MODEL_GATEWAY_ALIASES" "model-gateway"
    # Process environment values are one-run overrides for compose and helper
    # checks. Do not write them back into deploy/.env; local registry tests must
    # not silently become the operator's permanent production image source.

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
    local configured_aliases configured_container configured_network

    configured_network="$(env_value OPENAGENTS_DOCKER_NETWORK || true)"
    if [ -n "$configured_network" ]; then
        # Compose reads deploy/.env, so the helper must create/attach the same
        # external network that compose will later require.
        DOCKER_NETWORK="$configured_network"
    fi

    configured_container="$(env_value MODEL_GATEWAY_CONTAINER || true)"
    configured_aliases="$(env_value MODEL_GATEWAY_ALIASES || true)"

    # The external model gateway is an operator-owned dependency. Process
    # environment wins for one-off maintenance, then deploy/.env provides the
    # visible production setting; the script never guesses a container.
    if [ -z "$MODEL_GATEWAY_CONTAINER_FROM_ENV" ] && [ -n "$configured_container" ]; then
        MODEL_GATEWAY_CONTAINER="$configured_container"
    fi
    if [ -z "$MODEL_GATEWAY_ALIASES_FROM_ENV" ] && [ -n "$configured_aliases" ]; then
        MODEL_GATEWAY_ALIASES="$configured_aliases"
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

pull_configured_images() {
    if [ "$PULL_INFRA_IMAGES" = "1" ]; then
        warn "Pulling all compose images, including Postgres and MinIO. This may recreate infra containers if their tags changed."
        compose pull || fail "Image pull failed. Publish/fix the configured images before deploying."
        return
    fi

    # Normal production updates should refresh OpenAgents code images without
    # proactively moving stateful infrastructure tags such as postgres/minio.
    # Missing infra images on a first install are still pulled by compose up.
    info "Pulling OpenAgents runtime images only; infra image upgrades are skipped by default."
    compose pull "${OPENAGENTS_RUNTIME_SERVICES[@]}" || fail "OpenAgents runtime image pull failed. Run scripts/docker-release.sh push --scope ... or fix deploy/.env image settings first."
}

ensure_docker_network() {
    if docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
        # deploy/docker-compose.yml declares the bridge as external so the same
        # network can also hold a pre-existing model gateway container alias.
        info "Using existing Docker network: $DOCKER_NETWORK"
        return
    fi

    info "Creating Docker network: $DOCKER_NETWORK"
    docker network create "$DOCKER_NETWORK" >/dev/null
}

container_network_aliases() {
    docker inspect "$MODEL_GATEWAY_CONTAINER" \
        --format "{{with index .NetworkSettings.Networks \"$DOCKER_NETWORK\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" \
        2>/dev/null || true
}

desired_model_gateway_aliases() {
    local alias raw seen=""

    raw="${MODEL_GATEWAY_ALIASES//,/ }"
    for alias in $raw; do
        [ -n "$alias" ] || continue
        case " $seen " in
            *" $alias "*)
                ;;
            *)
                printf '%s\n' "$alias"
                seen="$seen $alias"
                ;;
        esac
    done
}

join_aliases() {
    local joined="" alias
    for alias in "$@"; do
        if [ -z "$joined" ]; then
            joined="$alias"
        else
            joined="$joined,$alias"
        fi
    done
    printf '%s\n' "$joined"
}

primary_model_gateway_alias() {
    local alias
    alias="$(desired_model_gateway_aliases | head -n 1 || true)"
    printf '%s\n' "${alias:-model-gateway}"
}

attach_model_gateway_if_requested() {
    local alias aliases missing_alias=0
    local desired_aliases=()
    local connect_args=()

    if [ -z "$MODEL_GATEWAY_CONTAINER" ]; then
        return
    fi

    mapfile -t desired_aliases < <(desired_model_gateway_aliases)
    [ "${#desired_aliases[@]}" -gt 0 ] || fail "MODEL_GATEWAY_ALIASES must include at least one alias"

    docker inspect "$MODEL_GATEWAY_CONTAINER" >/dev/null 2>&1 || fail "Model gateway container not found: $MODEL_GATEWAY_CONTAINER"

    if docker inspect "$MODEL_GATEWAY_CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$DOCKER_NETWORK\""; then
        aliases="$(container_network_aliases)"
        for alias in "${desired_aliases[@]}"; do
            if ! printf '%s\n' "$aliases" | grep -qx "$alias"; then
                missing_alias=1
            fi
        done
        if [ "$missing_alias" -eq 0 ]; then
            info "Model gateway is already attached to $DOCKER_NETWORK as $(join_aliases "${desired_aliases[@]}")"
            return
        fi

        # Docker cannot add aliases to an existing endpoint in place. Reconnect
        # only the explicitly configured external model gateway; deploy never
        # guesses which third-party gateway container should be mutated.
        warn "Model gateway is on $DOCKER_NETWORK but missing alias from $(join_aliases "${desired_aliases[@]}"); reconnecting it once."
        docker network disconnect "$DOCKER_NETWORK" "$MODEL_GATEWAY_CONTAINER"
    fi

    # The model gateway remains outside this compose file; this explicit attach
    # step gives OpenAgents a stable DNS name without starting another gateway
    # container or relying on a panel-generated container name.
    for alias in "${desired_aliases[@]}"; do
        connect_args+=(--alias "$alias")
    done
    docker network connect "${connect_args[@]}" "$DOCKER_NETWORK" "$MODEL_GATEWAY_CONTAINER"
    success "Attached $MODEL_GATEWAY_CONTAINER to $DOCKER_NETWORK as $(join_aliases "${desired_aliases[@]}")"
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
            --prepare-only)
                START=0
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

    info "Purpose: first install and production update. Image publishing uses scripts/docker-release.sh or GitHub Actions."
    info "Preparing deploy production directory"
    mkdir -p "$DEPLOY_DIR/data/openagents" "$DEPLOY_DIR/data/postgres" "$DEPLOY_DIR/data/minio" "$DEPLOY_DIR/data/logs"
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

    success "Created deploy/data/openagents, deploy/data/postgres, deploy/data/minio, deploy/data/logs"
    success "Synced .openagents/commands and .openagents/system into deploy/data/openagents"
    success "Synced reviewed SQL migrations into deploy/migrations"
    echo ""
    if [ -z "$MODEL_GATEWAY_CONTAINER" ]; then
        echo "Model gateway container is not configured; deploy did not attach or modify any external gateway."
    fi
    echo "Model gateway URL inside containers when alias exists: http://$(primary_model_gateway_alias):3000"

    if [ "$START" -eq 1 ]; then
        echo ""
        info "Starting production stack from deploy/docker-compose.yml"
        info "This run will pull configured images, apply reviewed SQL migrations, and restart services."
        if [ "$PULL_IMAGES" != "0" ]; then
            # Production deploy is pull-only for OpenAgents images. Building is
            # an explicit release step owned by scripts/docker-release.sh.
            pull_configured_images
        fi
        if [ "$PULL_IMAGES" = "0" ]; then
            compose up --pull never -d
        else
            compose up -d
        fi
        success "Production stack is started; the migrate service gates gateway/langgraph startup"
        echo ""
        echo "Open:"
        echo "  Admin: http://127.0.0.1:$(env_value OPENAGENTS_ADMIN_PORT || echo 8081)"
        echo "  App:   http://127.0.0.1:$(env_value OPENAGENTS_APP_PORT || echo 8083)"
        echo ""
        echo "Logs:"
        echo "  tail -f deploy/data/logs/gateway.log"
        echo "  tail -f deploy/data/logs/langgraph.log"
        echo "  ./scripts/docker-logs.sh"
        echo "  ./scripts/docker-logs.sh gateway"
        echo "  ./scripts/docker-logs.sh migrate --no-follow"
    else
        echo ""
        echo "Prepared only. Start later with:"
        echo "  cd deploy && docker compose -f docker-compose.yml up -d"
        echo "  tail -f deploy/data/logs/gateway.log"
        echo "  ./scripts/docker-logs.sh"
    fi
}

main "$@"
