#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEMO_COMPOSE_FILE="$PROJECT_ROOT/frontend/demo/compose.yaml"
DEMO_LOCAL_COMPOSE_FILE="$PROJECT_ROOT/frontend/demo/compose.local-deps.yaml"
DEMO_UI_DEFAULT_ENV_FILE="$PROJECT_ROOT/frontend/demo/.env.defaults"
DEMO_UI_LOCAL_ENV_FILE="$PROJECT_ROOT/frontend/demo/.env.local"
DEMO_UI_PROJECT_DIR="$PROJECT_ROOT/frontend/demo"
DEMO_MCP_PROJECT_DIR="$PROJECT_ROOT/frontend/demo/mcp-file-service"
DEMO_HEALTH_URL="http://127.0.0.1:8084/api/health"
DEFAULT_START_TIMEOUT_SECONDS="${DEMO_DOCKER_START_TIMEOUT_SECONDS:-180}"
DEFAULT_DEV_NETWORK="openagents_default"
DEFAULT_PROD_NETWORK="openagents-prod_openagents"
LOCAL_BASE_IMAGE="${MCP_WORKBENCH_FILE_SERVICE_LOCAL_BASE_IMAGE:-openagents-mcp-workbench-mcp-file-service-local-base}"
DEMO_NPM_REGISTRY="${DEMO_NPM_REGISTRY:-${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}}"
DEMO_PYTHON_INDEX_URL="${DEMO_PYTHON_INDEX_URL:-${UV_DEFAULT_INDEX:-https://mirrors.aliyun.com/pypi/simple/}}"
DEMO_APT_DEBIAN_MIRROR="${DEMO_APT_DEBIAN_MIRROR:-http://mirrors.aliyun.com/debian}"
DEMO_APT_SECURITY_MIRROR="${DEMO_APT_SECURITY_MIRROR:-http://mirrors.aliyun.com/debian-security}"
DEMO_NETWORK=""

resolve_demo_network() {
    if [ -n "${MCP_WORKBENCH_NETWORK:-}" ]; then
        echo "$MCP_WORKBENCH_NETWORK"
        return
    fi

    # The MCP URL exposed to agents is container-internal. Prefer the running
    # production network when it exists so the demo MCP can be bound from the
    # prod LangGraph container without users hand-editing localhost URLs.
    if docker network inspect "$DEFAULT_PROD_NETWORK" >/dev/null 2>&1; then
        echo "$DEFAULT_PROD_NETWORK"
        return
    fi

    echo "$DEFAULT_DEV_NETWORK"
}

compose() {
    local ui_env_file="$DEMO_UI_DEFAULT_ENV_FILE"

    if [ -z "$DEMO_NETWORK" ]; then
        DEMO_NETWORK="$(resolve_demo_network)"
    fi

    # The one-command demo path must work on a clean clone, so the compose
    # stack defaults to a tracked env file and only switches to the ignored
    # `.env.local` override when it actually exists.
    if [ -f "$DEMO_UI_LOCAL_ENV_FILE" ]; then
        ui_env_file="$DEMO_UI_LOCAL_ENV_FILE"
    fi

    MCP_WORKBENCH_UI_ENV_FILE="$ui_env_file" \
    MCP_WORKBENCH_FILE_SERVICE_LOCAL_BASE_IMAGE="$LOCAL_BASE_IMAGE" \
    MCP_WORKBENCH_NETWORK="$DEMO_NETWORK" \
        docker compose -f "$DEMO_COMPOSE_FILE" -f "$DEMO_LOCAL_COMPOSE_FILE" "$@"
}

ensure_demo_network() {
    if docker network inspect "$DEMO_NETWORK" >/dev/null 2>&1; then
        return
    fi

    echo -e "${BLUE}Creating demo Docker network: $DEMO_NETWORK${NC}"
    docker network create "$DEMO_NETWORK" >/dev/null
}

ensure_local_base_image() {
    if docker image inspect "$LOCAL_BASE_IMAGE" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Reusing local base image ${LOCAL_BASE_IMAGE}${NC}"
        return
    fi

    echo -e "${BLUE}Building demo OCR base image once: ${LOCAL_BASE_IMAGE}${NC}"
    docker build \
        --build-arg "PIP_INDEX_URL=$DEMO_PYTHON_INDEX_URL" \
        --build-arg "APT_DEBIAN_MIRROR=$DEMO_APT_DEBIAN_MIRROR" \
        --build-arg "APT_SECURITY_MIRROR=$DEMO_APT_SECURITY_MIRROR" \
        -t "$LOCAL_BASE_IMAGE" \
        -f "$PROJECT_ROOT/frontend/demo/mcp-file-service/Dockerfile.local-base" \
        "$PROJECT_ROOT"
}

bootstrap_python_deps() {
    echo -e "${BLUE}Syncing demo Python deps in ${DEMO_MCP_PROJECT_DIR}${NC}"
    # The mounted service runs inside a CPython 3.12 container, so the host
    # dependency environment must use the same ABI for import compatibility.
    # The default index is pinned here instead of relying on user-global uv
    # config so clean servers get the same fast bootstrap behavior.
    uv sync \
        --project "$DEMO_MCP_PROJECT_DIR" \
        --python 3.12 \
        --default-index "$DEMO_PYTHON_INDEX_URL" \
        --frozen
}

bootstrap_node_deps() {
    echo -e "${BLUE}Syncing demo Node deps in ${DEMO_UI_PROJECT_DIR}${NC}"
    # Keep the registry scoped to this command so the demo does not mutate a
    # developer's global pnpm/npm configuration.
    npm_config_registry="$DEMO_NPM_REGISTRY" \
        CI=true pnpm --dir "$DEMO_UI_PROJECT_DIR" install --frozen-lockfile
}

bootstrap() {
    DEMO_NETWORK="$(resolve_demo_network)"
    ensure_demo_network
    ensure_local_base_image
    bootstrap_python_deps
    bootstrap_node_deps
}

demo_containers_match_network() {
    local service
    local container_id

    for service in mcp-file-service mcp-workbench-ui mcp-workbench-gateway; do
        container_id="$(compose ps -q "$service" 2>/dev/null | head -n 1)"
        [ -n "$container_id" ] || return 1
        # Compose does not always recreate already-running containers when only
        # the external network name changes, so verify membership explicitly.
        [ "$(docker inspect "$container_id" --format "{{ if index .NetworkSettings.Networks \"$DEMO_NETWORK\" }}yes{{ end }}" 2>/dev/null)" = "yes" ] || return 1
    done
}

connect_demo_container_to_network() {
    local service="$1"
    local alias="$2"
    local network="$3"
    local container_id

    [ "$network" != "$DEMO_NETWORK" ] || return 0
    docker network inspect "$network" >/dev/null 2>&1 || return 0

    container_id="$(compose ps -q "$service" 2>/dev/null | head -n 1)"
    [ -n "$container_id" ] || return 0
    if [ "$(docker inspect "$container_id" --format "{{ if index .NetworkSettings.Networks \"$network\" }}yes{{ end }}" 2>/dev/null)" = "yes" ]; then
        return 0
    fi

    # Attach an alias on the selected extra network so LangGraph can use the
    # same system MCP profile URL when the demo is not compose-managed there.
    docker network connect --alias "$alias" "$network" "$container_id"
}

connect_demo_to_known_openagents_networks() {
    # The unified dev stack already exposes its own demo service on
    # openagents_default. Only add the standalone demo to prod when the primary
    # compose network is dev; connecting it back into dev can create duplicate
    # DNS aliases if the unified dev demo is also running.
    connect_demo_container_to_network mcp-file-service mcp-file-service "$DEFAULT_PROD_NETWORK"
    connect_demo_container_to_network mcp-workbench-ui mcp-workbench-ui "$DEFAULT_PROD_NETWORK"
    connect_demo_container_to_network mcp-workbench-gateway mcp-workbench-gateway "$DEFAULT_PROD_NETWORK"
}

wait_for_http_url() {
    local url="$1"
    local label="$2"
    local timeout_seconds="$3"
    local start_time

    start_time="$(date +%s)"
    while true; do
        if curl -fsS "$url" >/dev/null 2>&1; then
            echo -e "${GREEN}✓ ${label} is reachable${NC}"
            return 0
        fi

        if [ $(( $(date +%s) - start_time )) -ge "$timeout_seconds" ]; then
            echo -e "${RED}✗ ${label} is not reachable: ${url}${NC}"
            return 1
        fi

        sleep 2
    done
}

start() {
    echo "=========================================="
    echo "  Starting Demo Stack"
    echo "=========================================="
    echo ""

    bootstrap
    # The demo is intentionally local and dynamic: source directories are
    # bind-mounted so UI and MCP service edits apply without rebuilding images.
    if demo_containers_match_network; then
        compose up -d --no-build mcp-file-service mcp-workbench-ui mcp-workbench-gateway
    else
        compose up -d --no-build --force-recreate mcp-file-service mcp-workbench-ui mcp-workbench-gateway
    fi
    connect_demo_to_known_openagents_networks

    echo ""
    wait_for_http_url "$DEMO_HEALTH_URL" "demo health endpoint" "$DEFAULT_START_TIMEOUT_SECONDS"
    echo ""
    echo -e "${GREEN}✓ Demo stack is ready: http://127.0.0.1:8084${NC}"
    echo ""
}

stop() {
    echo -e "${BLUE}Stopping demo stack...${NC}"
    compose down
    echo -e "${GREEN}✓ Demo stack stopped${NC}"
}

status() {
    echo "=========================================="
    echo "  Demo Stack Status"
    echo "=========================================="
    echo ""
    compose ps
}

help() {
    echo "Demo stack helper"
    echo ""
    echo "Usage: $0 <start|stop|status>"
    echo ""
    echo "start is the only demo boot command. It prepares local deps and starts"
    echo "bind-mounted containers so source edits apply without image rebuilds."
    echo "When MCP_WORKBENCH_NETWORK is not set, start prefers"
    echo "$DEFAULT_PROD_NETWORK when present, otherwise $DEFAULT_DEV_NETWORK."
    echo ""
    echo "Env selection:"
    echo "  - Uses frontend/demo/.env.local when present"
    echo "  - Otherwise falls back to tracked frontend/demo/.env.defaults"
    echo ""
    echo "Dependency mirrors:"
    echo "  - DEMO_NPM_REGISTRY=$DEMO_NPM_REGISTRY"
    echo "  - DEMO_PYTHON_INDEX_URL=$DEMO_PYTHON_INDEX_URL"
    echo "  - DEMO_APT_DEBIAN_MIRROR=$DEMO_APT_DEBIAN_MIRROR"
    echo "  - DEMO_APT_SECURITY_MIRROR=$DEMO_APT_SECURITY_MIRROR"
}

case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    help|--help|-h|"")
        help
        ;;
    *)
        echo -e "${YELLOW}Unknown command: $1${NC}"
        echo ""
        help
        exit 1
        ;;
esac
