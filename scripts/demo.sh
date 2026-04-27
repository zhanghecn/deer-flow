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
DEMO_NETWORK="${MCP_WORKBENCH_NETWORK:-openagents_default}"
LOCAL_BASE_IMAGE="${MCP_WORKBENCH_FILE_SERVICE_LOCAL_BASE_IMAGE:-openagents-mcp-workbench-mcp-file-service-local-base}"

compose() {
    local ui_env_file="$DEMO_UI_DEFAULT_ENV_FILE"

    # The one-command demo path must work on a clean clone, so the compose
    # stack defaults to a tracked env file and only switches to the ignored
    # `.env.local` override when it actually exists.
    if [ -f "$DEMO_UI_LOCAL_ENV_FILE" ]; then
        ui_env_file="$DEMO_UI_LOCAL_ENV_FILE"
    fi

    MCP_WORKBENCH_UI_ENV_FILE="$ui_env_file" \
    MCP_WORKBENCH_FILE_SERVICE_LOCAL_BASE_IMAGE="$LOCAL_BASE_IMAGE" \
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
        -t "$LOCAL_BASE_IMAGE" \
        -f "$PROJECT_ROOT/frontend/demo/mcp-file-service/Dockerfile.local-base" \
        "$PROJECT_ROOT"
}

bootstrap_python_deps() {
    echo -e "${BLUE}Syncing demo Python deps in ${DEMO_MCP_PROJECT_DIR}${NC}"
    # The mounted service runs inside a CPython 3.12 container, so the host
    # dependency environment must use the same ABI for import compatibility.
    uv sync \
        --project "$DEMO_MCP_PROJECT_DIR" \
        --python 3.12 \
        --frozen
}

bootstrap_node_deps() {
    echo -e "${BLUE}Syncing demo Node deps in ${DEMO_UI_PROJECT_DIR}${NC}"
    CI=true pnpm --dir "$DEMO_UI_PROJECT_DIR" install --frozen-lockfile
}

bootstrap() {
    ensure_demo_network
    ensure_local_base_image
    bootstrap_python_deps
    bootstrap_node_deps
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
    compose up -d --no-build mcp-file-service mcp-workbench-ui mcp-workbench-gateway

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
    echo ""
    echo "Env selection:"
    echo "  - Uses frontend/demo/.env.local when present"
    echo "  - Otherwise falls back to tracked frontend/demo/.env.defaults"
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
