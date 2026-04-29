#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEMO_PROJECT_DIR="$PROJECT_ROOT/frontend/demo"
DEMO_COMPOSE_FILE="$DEMO_PROJECT_DIR/compose.yaml"
DEMO_UI_DEFAULT_ENV_FILE="$DEMO_PROJECT_DIR/.env.defaults"
DEMO_UI_LOCAL_ENV_FILE="$DEMO_PROJECT_DIR/.env.local"
DEMO_DATA_DIR="$DEMO_PROJECT_DIR/deploy/data"
DEMO_HEALTH_URL="http://127.0.0.1:8084/api/health"
DEFAULT_START_TIMEOUT_SECONDS="${DEMO_DOCKER_START_TIMEOUT_SECONDS:-180}"
DEFAULT_PROD_NETWORK="openagents-prod_openagents"
DEMO_NPM_REGISTRY="${DEMO_NPM_REGISTRY:-${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}}"
DEMO_PYTHON_INDEX_URL="${DEMO_PYTHON_INDEX_URL:-${UV_DEFAULT_INDEX:-https://mirrors.aliyun.com/pypi/simple/}}"
DEMO_APT_DEBIAN_MIRROR="${DEMO_APT_DEBIAN_MIRROR:-http://mirrors.aliyun.com/debian}"
DEMO_APT_SECURITY_MIRROR="${DEMO_APT_SECURITY_MIRROR:-http://mirrors.aliyun.com/debian-security}"

demo_env_file() {
    if [ -f "$DEMO_UI_LOCAL_ENV_FILE" ]; then
        echo "$DEMO_UI_LOCAL_ENV_FILE"
        return
    fi

    echo "$DEMO_UI_DEFAULT_ENV_FILE"
}

compose() {
    local ui_env_file

    ui_env_file="$(demo_env_file)"
    # Compose interpolation happens before containers exist. Pass the selected
    # UI env file to docker compose so Vite public values become build args for
    # the static nginx image instead of runtime-only container variables.
    DEMO_NPM_REGISTRY="$DEMO_NPM_REGISTRY" \
    DEMO_PYTHON_INDEX_URL="$DEMO_PYTHON_INDEX_URL" \
    DEMO_APT_DEBIAN_MIRROR="$DEMO_APT_DEBIAN_MIRROR" \
    DEMO_APT_SECURITY_MIRROR="$DEMO_APT_SECURITY_MIRROR" \
        docker compose \
            --project-directory "$DEMO_PROJECT_DIR" \
            --env-file "$ui_env_file" \
            -f "$DEMO_COMPOSE_FILE" \
            "$@"
}

bootstrap() {
    # The MCP service persists uploaded files and document-cache here so the
    # operator can inspect or delete demo state from the repository checkout.
    mkdir -p "$DEMO_DATA_DIR"
}

connect_demo_container_to_network() {
    local service="$1"
    local alias="$2"
    local network="$3"
    local container_id

    docker network inspect "$network" >/dev/null 2>&1 || return 0

    container_id="$(compose ps -q "$service" 2>/dev/null | head -n 1)"
    [ -n "$container_id" ] || return 0
    if [ "$(docker inspect "$container_id" --format "{{ if index .NetworkSettings.Networks \"$network\" }}yes{{ end }}" 2>/dev/null)" = "yes" ]; then
        return 0
    fi

    # The browser uses localhost:8084, but published OpenAgents MCP profiles
    # resolve mcp-file-service from the runtime network. Attach only the MCP
    # container, never the nginx/frontend container.
    docker network connect --alias "$alias" "$network" "$container_id"
}

connect_demo_to_agent_network() {
    if [ -n "${MCP_WORKBENCH_NETWORK:-}" ]; then
        connect_demo_container_to_network mcp-file-service mcp-file-service "$MCP_WORKBENCH_NETWORK"
        return
    fi

    connect_demo_container_to_network mcp-file-service mcp-file-service "$DEFAULT_PROD_NETWORK"
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
    compose up -d --build --remove-orphans mcp-file-service mcp-workbench
    connect_demo_to_agent_network

    echo ""
    wait_for_http_url "$DEMO_HEALTH_URL" "demo health endpoint" "$DEFAULT_START_TIMEOUT_SECONDS"
    echo ""
    echo -e "${GREEN}✓ Demo stack is ready: http://127.0.0.1:8084${NC}"
    echo -e "${GREEN}✓ Demo data directory: $DEMO_DATA_DIR${NC}"
    echo ""
}

stop() {
    echo -e "${BLUE}Stopping demo stack...${NC}"
    compose down --remove-orphans
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
    echo "start builds and runs two services: mcp-workbench and mcp-file-service."
    echo "Uploaded files and document caches are stored in:"
    echo "  $DEMO_DATA_DIR"
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
    echo ""
    echo "Host tools:"
    echo "  - Docker is required"
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
