#!/usr/bin/env bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
ROOT_ENV_FILE="$PROJECT_ROOT/.env"
DEFAULT_SANDBOX_AIO_IMAGE="enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest"
DEFAULT_SANDBOX_AIO_PORT="${OPENAGENTS_SANDBOX_PORT:-18080}"
DEFAULT_ONLYOFFICE_PORT="${OPENAGENTS_ONLYOFFICE_PORT:-8082}"
DEFAULT_LANGGRAPH_PORT="${OPENAGENTS_LANGGRAPH_PORT:-2024}"
DEFAULT_GATEWAY_PORT="${OPENAGENTS_GATEWAY_PORT:-8001}"
DEFAULT_APP_PORT="${OPENAGENTS_APP_PORT:-${OPENAGENTS_APP_DEV_PORT:-8083}}"
DEFAULT_ADMIN_PORT="${OPENAGENTS_ADMIN_PORT:-${OPENAGENTS_ADMIN_DEV_PORT:-8081}}"
DEFAULT_OPENPENCIL_PORT="${OPENAGENTS_OPENPENCIL_PORT:-3001}"
DEFAULT_DEMO_PORT="${OPENAGENTS_DEMO_PORT:-8084}"
DEFAULT_START_TIMEOUT_SECONDS="${OPENAGENTS_DOCKER_START_TIMEOUT_SECONDS:-180}"
DEFAULT_MODEL_GATEWAY_ALIAS="${MODEL_GATEWAY_ALIAS:-model-gateway}"
DEFAULT_COMPOSE_PROJECT="${OPENAGENTS_COMPOSE_PROJECT:-openagents}"
DEFAULT_MODEL_GATEWAY_NETWORK="${OPENAGENTS_MODEL_GATEWAY_NETWORK:-${MODEL_GATEWAY_NETWORK:-${DEFAULT_COMPOSE_PROJECT}_default}}"
COMPOSE_ARGS=(--env-file "$ROOT_ENV_FILE" -p "$DEFAULT_COMPOSE_PROJECT" -f docker-compose.yaml)
LEGACY_PROD_COMPOSE_ARGS=(--env-file "$ROOT_ENV_FILE" -p openagents-prod -f docker-compose-prod.yaml)

compose_stack() {
    cd "$DOCKER_DIR" && docker compose "${COMPOSE_ARGS[@]}" "$@"
}

compose_legacy_dev() {
    cd "$DOCKER_DIR" && docker compose --env-file "$ROOT_ENV_FILE" -p openagents-dev -f docker-compose.yaml "$@"
}

compose_legacy_prod() {
    cd "$DOCKER_DIR" && docker compose "${LEGACY_PROD_COMPOSE_ARGS[@]}" "$@"
}

# Keep the historical helper names as compatibility shims now that both
# previous labels point at the same canonical compose file.
compose_dev() {
    compose_stack "$@"
}

compose_prod() {
    compose_stack "$@"
}

detect_model_gateway_container() {
    local configured="${MODEL_GATEWAY_CONTAINER:-}"
    local name=""

    if [ -n "$configured" ]; then
        echo "$configured"
        return 0
    fi

    # Unified compose still needs to reuse an external model gateway when
    # operators keep `new-api` outside this repository. Prefer containers that
    # already advertise the canonical `model-gateway` alias on any legacy
    # bridge, then fall back to common container names.
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        if docker inspect "$name" --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"$DEFAULT_MODEL_GATEWAY_ALIAS\""; then
            echo "$name"
            return 0
        fi
    done < <(docker ps --format '{{.Names}}')

    docker ps --format '{{.Names}}' | grep -E '(^|-)new-api($|-)|(^|-)model-gateway($|-)' | head -n 1 || true
}

attach_optional_model_gateway() {
    local gateway_container=""

    gateway_container="$(detect_model_gateway_container)"

    # Many local deployments keep the model gateway outside this repository.
    # Auto-detect the common external gateway container so the unified stack can
    # keep the canonical
    # `http://model-gateway:3000` base URL in both dev and prod.
    if [ -z "$gateway_container" ]; then
        return 0
    fi

    if ! docker inspect "$gateway_container" >/dev/null 2>&1; then
        echo -e "${YELLOW}MODEL_GATEWAY_CONTAINER is set but not found: $gateway_container${NC}"
        return 0
    fi

    if ! docker network inspect "$DEFAULT_MODEL_GATEWAY_NETWORK" >/dev/null 2>&1; then
        echo -e "${YELLOW}Docker network not found for external model gateway: $DEFAULT_MODEL_GATEWAY_NETWORK${NC}"
        return 0
    fi

    if docker inspect "$gateway_container" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$DEFAULT_MODEL_GATEWAY_NETWORK\""; then
        echo -e "${GREEN}✓ External model gateway already attached to $DEFAULT_MODEL_GATEWAY_NETWORK${NC}"
        return 0
    fi

    if [ -z "${MODEL_GATEWAY_CONTAINER:-}" ]; then
        echo -e "${BLUE}Auto-detected external model gateway container: $gateway_container${NC}"
    fi

    docker network connect --alias "$DEFAULT_MODEL_GATEWAY_ALIAS" "$DEFAULT_MODEL_GATEWAY_NETWORK" "$gateway_container"
    echo -e "${GREEN}✓ Attached external model gateway '$gateway_container' to $DEFAULT_MODEL_GATEWAY_NETWORK as $DEFAULT_MODEL_GATEWAY_ALIAS${NC}"
}

warn_if_model_gateway_unresolved() {
    local langgraph_container

    langgraph_container="$(compose_dev ps -q langgraph | head -n 1)"
    if [ -z "$langgraph_container" ]; then
        return 0
    fi

    if docker exec "$langgraph_container" /bin/sh -lc "getent hosts '$DEFAULT_MODEL_GATEWAY_ALIAS' >/dev/null 2>&1"; then
        echo -e "${GREEN}✓ ${DEFAULT_MODEL_GATEWAY_ALIAS} resolves inside langgraph${NC}"
        return 0
    fi

    echo -e "${YELLOW}Warning: ${DEFAULT_MODEL_GATEWAY_ALIAS} does not resolve inside langgraph.${NC}"
    echo -e "${YELLOW}If your models use http://${DEFAULT_MODEL_GATEWAY_ALIAS}:3000, export MODEL_GATEWAY_CONTAINER=<external-container> before make docker-start.${NC}"
}

stop_repo_managed_port_conflicts() {
    # The unified stack intentionally owns the public app/admin/demo ports.
    # Stop legacy repo-managed stacks first so operators do not misread a stale
    # process as "the current compose file is still serving old code".
    if docker ps --format '{{.Names}}' | grep -Eq '^openagents-mcp-workbench-'; then
        echo -e "${BLUE}Stopping legacy standalone demo stack on port ${DEFAULT_DEMO_PORT}...${NC}"
        docker compose \
            -p openagents-mcp-workbench \
            -f "$PROJECT_ROOT/frontend/demo/compose.yaml" \
            down >/dev/null 2>&1 || true
    fi

    if docker ps --format '{{.Names}}' | grep -Eq '^openagents-(dev|prod)-'; then
        echo -e "${BLUE}Stopping legacy split compose stacks before starting the unified stack...${NC}"
        compose_legacy_dev down >/dev/null 2>&1 || true
        compose_legacy_prod down >/dev/null 2>&1 || true
    fi
}

require_vendored_openpencil_tree() {
    local openpencil_root="$PROJECT_ROOT/openpencil"

    # The prod compose file builds OpenPencil from the vendored repo copy.
    # Validate the expected tree up front so operators get a direct fix path
    # instead of a late Docker COPY checksum failure.
    if [ ! -f "$openpencil_root/Dockerfile" ]; then
        echo -e "${RED}Missing vendored OpenPencil Dockerfile: $openpencil_root/Dockerfile${NC}"
        exit 1
    fi

    if [ ! -f "$openpencil_root/apps/web/package.json" ]; then
        echo -e "${RED}Vendored OpenPencil tree is incomplete: $openpencil_root/apps/web/package.json${NC}"
        echo -e "${YELLOW}Sync the committed openpencil/ directory before running the prod stack.${NC}"
        exit 1
    fi
}

ensure_root_env_file() {
    if [ -f "$ROOT_ENV_FILE" ]; then
        return
    fi

    echo -e "${YELLOW}Missing root env file: $ROOT_ENV_FILE${NC}"
    echo -e "${YELLOW}Create it manually with required secrets before starting services.${NC}"
    exit 1
}

detect_sandbox_provider() {
    local provider="${OPENAGENTS_SANDBOX_PROVIDER:-}"
    local config_file="$PROJECT_ROOT/config.yaml"

    if [ -n "$provider" ]; then
        echo "$provider"
        return
    fi

    if [ ! -f "$config_file" ]; then
        return
    fi

    awk '
        /^[[:space:]]*sandbox:[[:space:]]*$/ { in_sandbox=1; next }
        in_sandbox && /^[^[:space:]#]/ { in_sandbox=0 }
        in_sandbox && /^[[:space:]]*use:[[:space:]]*/ {
            line=$0
            sub(/^[[:space:]]*use:[[:space:]]*/, "", line)
            print line
            exit
        }
    ' "$config_file"
}

detect_sandbox_mode() {
    local config_file="$PROJECT_ROOT/config.yaml"
    local sandbox_use=""
    local provisioner_url=""

    sandbox_use="$(detect_sandbox_provider)"

    if [ -f "$config_file" ]; then
        provisioner_url=$(awk '
            /^[[:space:]]*sandbox:[[:space:]]*$/ { in_sandbox=1; next }
            in_sandbox && /^[^[:space:]#]/ { in_sandbox=0 }
            in_sandbox && /^[[:space:]]*provisioner_url:[[:space:]]*/ {
                line=$0
                sub(/^[[:space:]]*provisioner_url:[[:space:]]*/, "", line)
                print line
                exit
            }
        ' "$config_file")
    fi

    if [[ -z "$sandbox_use" || "$sandbox_use" == *"src.sandbox.local:LocalSandboxProvider"* ]]; then
        echo "local"
    elif [[ "$sandbox_use" == *"src.community.aio_sandbox:AioSandboxProvider"* ]]; then
        if [ -n "$provisioner_url" ]; then
            echo "provisioner"
        else
            echo "aio"
        fi
    else
        echo "local"
    fi
}

require_provisioner_env() {
    local node_host="${NODE_HOST:-}"

    if [ -z "$node_host" ]; then
        echo -e "${YELLOW}Provisioner mode requires NODE_HOST exported in the shell.${NC}"
        echo -e "${YELLOW}Set it to a real host/IP/DNS name reachable from gateway/langgraph containers.${NC}"
        exit 1
    fi
}

resolve_openagents_home() {
    local configured_home="${OPENAGENTS_DOCKER_HOST_HOME:-deploy/data/openagents}"
    local resolved_home

    if [[ "$configured_home" = /* ]]; then
        resolved_home="$configured_home"
    else
        resolved_home="$PROJECT_ROOT/$configured_home"
    fi

    mkdir -p "$(dirname "$resolved_home")"
    resolved_home="$(cd "$(dirname "$resolved_home")" && pwd)/$(basename "$resolved_home")"
    export OPENAGENTS_DOCKER_HOST_HOME="$resolved_home"
}

list_managed_services() {
    local sandbox_mode

    sandbox_mode="$(detect_sandbox_mode)"
    if [ "$sandbox_mode" = "provisioner" ]; then
        echo "sandbox-aio onlyoffice langgraph gateway openpencil app admin demo-mcp-file-service demo provisioner"
        return
    fi

    echo "$(list_dev_services)"
}

list_dev_services() {
    # The writable dev compose owns every runtime service so a clean checkout
    # can run entirely inside Docker without host-installed Node/uv/Go tooling.
    echo "sandbox-aio onlyoffice langgraph gateway openpencil app admin demo-mcp-file-service demo"
}

wait_for_service_ready() {
    local compose_fn="$1"
    local service="$2"
    local timeout_seconds="$3"
    local start_time
    local container_id=""
    local state=""
    local health=""

    start_time="$(date +%s)"
    while true; do
        container_id="$($compose_fn ps -q "$service" | head -n 1)"
        if [ -n "$container_id" ]; then
            state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
            health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)"

            if [ "$state" = "running" ] && { [ -z "$health" ] || [ "$health" = "healthy" ]; }; then
                echo -e "${GREEN}✓ ${service} is ready${NC}"
                return 0
            fi
        fi

        # `docker compose up -d` returns after scheduling work, not after every
        # container is actually running. Treat lingering `created` states as a
        # failed startup once the timeout expires so operators do not get a
        # false-positive "stack started" message.
        if [ $(( $(date +%s) - start_time )) -ge "$timeout_seconds" ]; then
            echo -e "${RED}✗ ${service} did not become ready within ${timeout_seconds}s${NC}"
            if [ -n "$container_id" ]; then
                echo -e "${YELLOW}Current state: ${state:-unknown}${NC}"
                if [ -n "$health" ]; then
                    echo -e "${YELLOW}Current health: ${health}${NC}"
                fi
                $compose_fn logs --tail=40 "$service" || true
            else
                echo -e "${YELLOW}No container has been created for service ${service}.${NC}"
            fi
            return 1
        fi

        sleep 2
    done
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

verify_dev_stack() {
    local timeout_seconds="${1:-$DEFAULT_START_TIMEOUT_SECONDS}"
    local service=""
    local -a services

    read -r -a services <<< "$(list_dev_services)"

    echo -e "${BLUE}Waiting for Docker services to become ready...${NC}"
    for service in "${services[@]}"; do
        wait_for_service_ready compose_dev "$service" "$timeout_seconds" || return 1
    done

    echo ""
    echo -e "${BLUE}Verifying Docker HTTP entrypoints...${NC}"
    wait_for_http_url "http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}/v1/sandbox" "sandbox-aio endpoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_ONLYOFFICE_PORT}/healthcheck" "ONLYOFFICE endpoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_LANGGRAPH_PORT}/docs" "LangGraph API docs endpoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/health" "gateway health endpoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_OPENPENCIL_PORT}/openpencil/editor" "OpenPencil endpoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_APP_PORT}/" "app entrypoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_ADMIN_PORT}/" "admin entrypoint" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_DEMO_PORT}/api/health" "demo dev workbench API" "$timeout_seconds" || return 1
    wait_for_http_url "http://127.0.0.1:${DEFAULT_DEMO_PORT}/" "demo entrypoint" "$timeout_seconds" || return 1

    echo ""
    compose_dev ps
}

verify_prod_stack() {
    verify_dev_stack "$1"
}

status() {
    echo "========================================"
    echo "  OpenAgents Docker Stack Status"
    echo "========================================"
    echo ""

    ensure_root_env_file
    compose_dev ps
}

verify() {
    echo "========================================"
    echo "  Verifying OpenAgents Docker Stack"
    echo "========================================"
    echo ""

    ensure_root_env_file
    verify_dev_stack "$DEFAULT_START_TIMEOUT_SECONDS"
}

# Cleanup function for Ctrl+C
cleanup() {
    echo ""
    echo -e "${YELLOW}Operation interrupted by user${NC}"
    exit 130
}

# Set up trap for Ctrl+C
trap cleanup INT TERM

# Initialize: pre-pull the sandbox image so first Pod startup is fast
init() {
    echo "=========================================="
    echo "  OpenAgents Init — Pull Sandbox Image"
    echo "=========================================="
    echo ""

    ensure_root_env_file

    SANDBOX_IMAGE="$DEFAULT_SANDBOX_AIO_IMAGE"

    if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${SANDBOX_IMAGE}$"; then
        echo -e "${BLUE}Pulling sandbox image: $SANDBOX_IMAGE ...${NC}"
        docker pull "$SANDBOX_IMAGE"
    else
        echo -e "${GREEN}Sandbox image already exists locally: $SANDBOX_IMAGE${NC}"
    fi

    echo ""
    echo -e "${GREEN}✓ Sandbox image is ready.${NC}"
    echo ""
    echo -e "${YELLOW}Next step: make docker-start${NC}"
}

# Start the local Docker development stack. Source code is bind-mounted
# read-write, while dependency caches live under OPENAGENTS_DOCKER_HOST_HOME.
start() {
    echo "=========================================="
    echo "  Starting OpenAgents Docker Stack"
    echo "=========================================="
    echo ""

    ensure_root_env_file
    resolve_openagents_home
    echo -e "${BLUE}Using OPENAGENTS_DOCKER_HOST_HOME=$OPENAGENTS_DOCKER_HOST_HOME${NC}"
    echo -e "${BLUE}Starting the unified Docker stack from docker-compose.yaml.${NC}"
    echo ""

    stop_repo_managed_port_conflicts

    echo "Building and starting containers..."
    compose_dev up --build -d --remove-orphans
    attach_optional_model_gateway
    echo ""
    verify_dev_stack "$DEFAULT_START_TIMEOUT_SECONDS"
    warn_if_model_gateway_unresolved
    echo ""
    echo "=========================================="
    echo "  OpenAgents Docker Stack is ready"
    echo "=========================================="
    echo ""
    echo "  🌐 App:         http://127.0.0.1:${DEFAULT_APP_PORT}"
    echo "  🛠 Admin:       http://127.0.0.1:${DEFAULT_ADMIN_PORT}"
    echo "  🧪 Demo:        http://127.0.0.1:${DEFAULT_DEMO_PORT}"
    echo "  ✏️ OpenPencil:  http://127.0.0.1:${DEFAULT_OPENPENCIL_PORT}/openpencil/editor"
    echo "  📡 Gateway:     http://127.0.0.1:${DEFAULT_GATEWAY_PORT}"
    echo "  🤖 LangGraph:   http://127.0.0.1:${DEFAULT_LANGGRAPH_PORT}"
    echo "  📦 Sandbox UI:  http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}"
    echo "  📝 ONLYOFFICE:  http://127.0.0.1:${DEFAULT_ONLYOFFICE_PORT}"
    echo ""
    echo "  📋 View logs: make docker-logs"
    echo "  🛑 Stop:      make docker-stop"
    echo ""
}

# Keep an infra-only shortcut for debugging dependency services without the rest
# of the writable source-mounted stack.
infra_start() {
    echo "=========================================="
    echo "  Starting OpenAgents Local Debug Infra"
    echo "=========================================="
    echo ""

    ensure_root_env_file
    resolve_openagents_home

    echo -e "${BLUE}Using OPENAGENTS_DOCKER_HOST_HOME=$OPENAGENTS_DOCKER_HOST_HOME${NC}"
    echo -e "${BLUE}Starting sandbox-aio + ONLYOFFICE only; app/runtime containers stay stopped.${NC}"
    echo ""

    compose_dev up -d sandbox-aio onlyoffice

    echo ""
    echo -e "${GREEN}✓ Local debug infra is starting${NC}"
    echo "  Sandbox AIO: http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}"
    echo "  ONLYOFFICE:  http://127.0.0.1:${DEFAULT_ONLYOFFICE_PORT}"
    echo "  Full stack:  run 'make docker-start'"
    echo ""
}

# View Docker stack logs.
logs() {
    local service=""
    
    case "$1" in
        --sandbox-aio)
            service="sandbox-aio"
            echo -e "${BLUE}Viewing sandbox-aio logs...${NC}"
            ;;
        --onlyoffice)
            service="onlyoffice"
            echo -e "${BLUE}Viewing onlyoffice logs...${NC}"
            ;;
        --gateway)
            service="gateway"
            echo -e "${BLUE}Viewing gateway logs...${NC}"
            ;;
        --langgraph)
            service="langgraph"
            echo -e "${BLUE}Viewing langgraph logs...${NC}"
            ;;
        --app)
            service="app"
            echo -e "${BLUE}Viewing app logs...${NC}"
            ;;
        --admin)
            service="admin"
            echo -e "${BLUE}Viewing admin logs...${NC}"
            ;;
        --demo)
            service="demo"
            echo -e "${BLUE}Viewing demo logs...${NC}"
            ;;
        --openpencil)
            service="openpencil"
            echo -e "${BLUE}Viewing OpenPencil logs...${NC}"
            ;;
        "")
            echo -e "${BLUE}Viewing all Docker dev stack logs...${NC}"
            ;;
        *)
            echo -e "${YELLOW}Unknown option: $1${NC}"
            echo "Usage: $0 logs [--sandbox-aio|--onlyoffice|--gateway|--langgraph|--app|--admin|--demo|--openpencil]"
            exit 1
            ;;
    esac
    
    compose_dev logs -f $service
}

# Stop the local Docker development stack.
stop() {
    echo "Stopping Docker services..."
    compose_dev down
    echo -e "${GREEN}✓ Docker services stopped${NC}"
}

# Stop only the shared Docker infra without touching the full writable dev
# stack's source-mounted runtime containers.
infra_stop() {
    echo "Stopping OpenAgents local debug infra..."
    compose_dev stop sandbox-aio onlyoffice >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Local debug infra stopped${NC}"
}

# Restart the local Docker development stack.
restart() {
    echo "========================================"
    echo "  Restarting OpenAgents Docker Stack"
    echo "========================================"
    echo ""
    ensure_root_env_file
    resolve_openagents_home
    echo -e "${BLUE}Restarting containers...${NC}"
    compose_dev restart
    # Keep restart semantics aligned with start: a user who only ever restarts
    # the unified stack should still recover the external model gateway alias.
    attach_optional_model_gateway
    echo ""
    verify_dev_stack "$DEFAULT_START_TIMEOUT_SECONDS"
    warn_if_model_gateway_unresolved
    echo ""
    echo -e "${GREEN}✓ Docker services restarted${NC}"
    echo ""
    echo "  🌐 App:         http://127.0.0.1:${DEFAULT_APP_PORT}"
    echo "  🛠 Admin:       http://127.0.0.1:${DEFAULT_ADMIN_PORT}"
    echo "  🧪 Demo:        http://127.0.0.1:${DEFAULT_DEMO_PORT}"
    echo "  ✏️ OpenPencil:  http://127.0.0.1:${DEFAULT_OPENPENCIL_PORT}/openpencil/editor"
    echo "  📦 Sandbox UI:  http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}"
    echo "  📝 ONLYOFFICE:  http://127.0.0.1:${DEFAULT_ONLYOFFICE_PORT}"
    echo "  📋 View logs: make docker-logs"
    echo ""
}

prod_status() {
    echo -e "${BLUE}prod-status is now a compatibility alias for the unified Docker stack.${NC}"
    echo ""
    status
}

prod_verify() {
    echo -e "${BLUE}prod-verify is now a compatibility alias for the unified Docker stack.${NC}"
    echo ""
    verify
}

prod_start() {
    echo -e "${BLUE}prod-start is now a compatibility alias for the unified Docker stack.${NC}"
    echo ""
    start
}

prod_restart() {
    echo -e "${BLUE}prod-restart is now a compatibility alias for the unified Docker stack.${NC}"
    echo ""
    restart
}

# Show help
help() {
    echo "OpenAgents Docker Management Script"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Common commands:"
    echo "  start           - Start the writable Docker dev stack"
    echo "  stop            - Stop the Docker stack"
    echo "  restart         - Restart and verify the Docker stack"
    echo "  status          - Show container status"
    echo "  verify          - Verify containers and HTTP entrypoints"
    echo "  logs [service]  - Follow logs"
    echo "                    --gateway | --langgraph | --app | --admin | --demo"
    echo "                    --sandbox-aio | --onlyoffice | --openpencil"
    echo ""
    echo "Setup / advanced:"
    echo "  init            - Pull the sandbox image"
    echo "  infra-start     - Start only sandbox-aio + ONLYOFFICE"
    echo "  infra-stop      - Stop only sandbox-aio + ONLYOFFICE"
    echo "  docker workflow - See docs/guides/docker-compose-prod-selfhost-zh.md"
    echo ""
}

main() {
    case "$1" in
        help|--help|-h|"")
            help
            return
            ;;
    esac

    ensure_root_env_file

    # Main command dispatcher
    case "$1" in
        init)
            init
            ;;
        start)
            start
            ;;
        infra-start)
            infra_start
            ;;
        status)
            status
            ;;
        verify)
            verify
            ;;
        restart)
            restart
            ;;
        logs)
            logs "$2"
            ;;
        stop)
            stop
            ;;
        infra-stop)
            infra_stop
            ;;
        prod-start)
            prod_start
            ;;
        prod-status)
            prod_status
            ;;
        prod-verify)
            prod_verify
            ;;
        prod-restart)
            prod_restart
            ;;
        *)
            echo -e "${YELLOW}Unknown command: $1${NC}"
            echo ""
            help
            exit 1
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
