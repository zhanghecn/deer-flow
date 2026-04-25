#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEMO_COMPOSE_FILE="$PROJECT_ROOT/frontend/demo/compose.yaml"
DEMO_LOCAL_COMPOSE_FILE="$PROJECT_ROOT/frontend/demo/compose.local-deps.yaml"
DEMO_UI_DEFAULT_ENV_FILE="$PROJECT_ROOT/frontend/demo/.env.defaults"
DEMO_UI_LOCAL_ENV_FILE="$PROJECT_ROOT/frontend/demo/.env.local"
DEMO_UI_PROJECT_DIR="$PROJECT_ROOT/frontend/demo"
DEMO_MCP_PROJECT_DIR="$PROJECT_ROOT/frontend/demo/mcp-file-service"
LOCAL_BASE_IMAGE="${MCP_WORKBENCH_FILE_SERVICE_LOCAL_BASE_IMAGE:-openagents-mcp-workbench-mcp-file-service-local-base}"

compose() {
    local ui_env_file="$DEMO_UI_DEFAULT_ENV_FILE"

    if [ -f "$DEMO_UI_LOCAL_ENV_FILE" ]; then
        ui_env_file="$DEMO_UI_LOCAL_ENV_FILE"
    fi

    MCP_WORKBENCH_UI_ENV_FILE="$ui_env_file" \
    MCP_WORKBENCH_FILE_SERVICE_LOCAL_BASE_IMAGE="$LOCAL_BASE_IMAGE" \
        docker compose -f "$DEMO_COMPOSE_FILE" -f "$DEMO_LOCAL_COMPOSE_FILE" "$@"
}

ensure_local_base_image() {
    if docker image inspect "$LOCAL_BASE_IMAGE" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Reusing local base image ${LOCAL_BASE_IMAGE}${NC}"
        return
    fi

    echo -e "${BLUE}Building local OCR base image once: ${LOCAL_BASE_IMAGE}${NC}"
    docker build \
        -t "$LOCAL_BASE_IMAGE" \
        -f "$PROJECT_ROOT/frontend/demo/mcp-file-service/Dockerfile.local-base" \
        "$PROJECT_ROOT"
}

bootstrap_python_deps() {
    echo -e "${BLUE}Syncing local Python deps with uv in ${DEMO_MCP_PROJECT_DIR}${NC}"
    # Keep the demo service environment on CPython 3.12 so the host-built
    # wheels match the ABI used by the mounted demo container.
    uv sync \
        --project "$DEMO_MCP_PROJECT_DIR" \
        --python 3.12 \
        --frozen
}

bootstrap_node_deps() {
    echo -e "${BLUE}Syncing local Node deps in ${DEMO_UI_PROJECT_DIR}${NC}"
    CI=true pnpm --dir "$DEMO_UI_PROJECT_DIR" install --frozen-lockfile
}

bootstrap() {
    ensure_local_base_image
    bootstrap_python_deps
    bootstrap_node_deps
}

start() {
    bootstrap
    echo -e "${BLUE}Starting demo stack with local uv/pnpm dependencies...${NC}"
    # The local mode mounts the project directories directly, so source edits
    # take effect without rebuilding the full app images on every restart.
    compose up -d --no-build mcp-file-service mcp-workbench-ui mcp-workbench-gateway
    echo -e "${GREEN}✓ Demo local-deps stack is ready: http://127.0.0.1:8084${NC}"
}

stop() {
    echo -e "${BLUE}Stopping demo local-deps stack...${NC}"
    compose down
    echo -e "${GREEN}✓ Demo local-deps stack stopped${NC}"
}

status() {
    echo "=========================================="
    echo "  Demo Local-Deps Stack Status"
    echo "=========================================="
    echo ""
    compose ps
}

help() {
    cat <<EOF
Demo local dependency helper

Usage: $0 <bootstrap|start|stop|status>

This mode avoids repeated demo rebuilds by:
  1. building the OCR system-dependency base image once
  2. syncing Python deps locally with uv in frontend/demo/mcp-file-service/.venv
  3. syncing Node deps locally in frontend/demo/node_modules
  4. bind-mounting the project directories into the running containers

Local Python deps are managed with:
  uv sync --project frontend/demo/mcp-file-service --python 3.12 --frozen

Local Node deps are managed with:
  pnpm --dir frontend/demo install --frozen-lockfile
EOF
}

case "${1:-}" in
    bootstrap)
        bootstrap
        ;;
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
