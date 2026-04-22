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
DEMO_HEALTH_URL="http://127.0.0.1:8084/api/health"
DEFAULT_START_TIMEOUT_SECONDS="${DEMO_DOCKER_START_TIMEOUT_SECONDS:-180}"
DEFAULT_REPO_OWNER="zhanghecn"
DEFAULT_IMAGE_TAG="${DEMO_IMAGE_TAG:-latest}"

compose() {
    docker compose -f "$DEMO_COMPOSE_FILE" "$@"
}

resolve_repo_owner() {
    local remote_url
    remote_url="$(git -C "$PROJECT_ROOT" config --get remote.origin.url 2>/dev/null || true)"

    if [[ "$remote_url" =~ github\.com[:/]([^/]+)/[^/]+(\.git)?$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi

    echo "${DEMO_IMAGE_OWNER:-$DEFAULT_REPO_OWNER}"
}

resolve_image_namespace() {
    if [ -n "${DEMO_IMAGE_NAMESPACE:-}" ]; then
        echo "$DEMO_IMAGE_NAMESPACE"
        return
    fi

    echo "ghcr.io/$(resolve_repo_owner)"
}

has_local_demo_edits() {
    # A local source edit should win over remote image pulls so the user keeps
    # one stable command while still seeing current workspace changes.
    [ -n "$(git -C "$PROJECT_ROOT" status --porcelain -- frontend/demo .github/workflows/publish-demo-images.yml 2>/dev/null || true)" ]
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
    local image_namespace
    local file_service_image
    local ui_image

    echo "=========================================="
    echo "  Starting Demo Stack"
    echo "=========================================="
    echo ""

    if has_local_demo_edits; then
        echo -e "${BLUE}Detected local demo changes. Building from the current workspace.${NC}"
        compose up -d --build mcp-file-service mcp-workbench-ui mcp-workbench-gateway
    else
        image_namespace="$(resolve_image_namespace)"
        file_service_image="${image_namespace}/deer-flow-demo-mcp-file-service:${DEFAULT_IMAGE_TAG}"
        ui_image="${image_namespace}/deer-flow-demo-mcp-workbench-ui:${DEFAULT_IMAGE_TAG}"

        echo -e "${BLUE}Trying prebuilt demo images first:${NC}"
        echo "  $file_service_image"
        echo "  $ui_image"
        echo ""

        if MCP_WORKBENCH_FILE_SERVICE_IMAGE="$file_service_image" \
           MCP_WORKBENCH_UI_IMAGE="$ui_image" \
           compose pull mcp-file-service mcp-workbench-ui; then
            MCP_WORKBENCH_FILE_SERVICE_IMAGE="$file_service_image" \
            MCP_WORKBENCH_UI_IMAGE="$ui_image" \
            compose up -d mcp-file-service mcp-workbench-ui mcp-workbench-gateway
        else
            echo ""
            echo -e "${YELLOW}Prebuilt demo images are unavailable. Falling back to a local build.${NC}"
            compose up -d --build mcp-file-service mcp-workbench-ui mcp-workbench-gateway
        fi
    fi

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
    echo "The default start flow is intentionally simple:"
    echo "  1. If local demo files changed, build from the workspace"
    echo "  2. Otherwise try GHCR prebuilt images"
    echo "  3. If images are unavailable, fall back to a local build"
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
