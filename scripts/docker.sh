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
DEFAULT_SANDBOX_AIO_PORT="18080"
DEFAULT_START_TIMEOUT_SECONDS="${OPENAGENTS_DOCKER_START_TIMEOUT_SECONDS:-180}"
APP_PUBLIC_URL="http://127.0.0.1:8083"
ADMIN_PUBLIC_URL="http://127.0.0.1:8081"
GATEWAY_HEALTH_URL="${APP_PUBLIC_URL}/health"

# Docker Compose arguments. The repository now uses one production-style
# compose file for both local Docker runs and release-style deployments.
COMPOSE_ARGS=(--env-file "$ROOT_ENV_FILE" -p openagents-prod -f docker-compose-prod.yaml)

compose() {
    cd "$DOCKER_DIR" && docker compose "${COMPOSE_ARGS[@]}" "$@"
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
    local configured_home="${OPENAGENTS_DOCKER_HOST_HOME:-.openagents}"
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
        echo "sandbox-aio onlyoffice provisioner langgraph gateway nginx"
        return
    fi

    echo "sandbox-aio onlyoffice langgraph gateway nginx"
}

wait_for_service_ready() {
    local service="$1"
    local timeout_seconds="$2"
    local start_time
    local container_id=""
    local state=""
    local health=""

    start_time="$(date +%s)"
    while true; do
        container_id="$(compose ps -q "$service" | head -n 1)"
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
                compose logs --tail=40 "$service" || true
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

verify_stack() {
    local timeout_seconds="${1:-$DEFAULT_START_TIMEOUT_SECONDS}"
    local service
    local -a services

    read -r -a services <<< "$(list_managed_services)"

    echo -e "${BLUE}Waiting for compose services to become ready...${NC}"
    for service in "${services[@]}"; do
        wait_for_service_ready "$service" "$timeout_seconds" || return 1
    done

    echo ""
    echo -e "${BLUE}Verifying public HTTP entrypoints...${NC}"
    wait_for_http_url "$GATEWAY_HEALTH_URL" "gateway health endpoint" "$timeout_seconds" || return 1
    wait_for_http_url "${APP_PUBLIC_URL}/" "app entrypoint" "$timeout_seconds" || return 1
    wait_for_http_url "${ADMIN_PUBLIC_URL}/" "admin entrypoint" "$timeout_seconds" || return 1

    echo ""
    compose ps
}

status() {
    echo "========================================"
    echo "  OpenAgents Docker Status"
    echo "========================================"
    echo ""

    ensure_root_env_file
    compose ps
}

verify() {
    echo "========================================"
    echo "  Verifying OpenAgents Docker Stack"
    echo "========================================"
    echo ""

    ensure_root_env_file
    verify_stack "$DEFAULT_START_TIMEOUT_SECONDS"
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

# Start the unified Docker Compose stack.
start() {
    local sandbox_mode
    local -a services

    echo "=========================================="
    echo "  Starting OpenAgents Docker Stack"
    echo "=========================================="
    echo ""

    ensure_root_env_file

    sandbox_mode="$(detect_sandbox_mode)"

    if [ "$sandbox_mode" = "provisioner" ]; then
        require_provisioner_env
        services=(sandbox-aio provisioner onlyoffice langgraph gateway nginx)
    else
        services=(sandbox-aio onlyoffice langgraph gateway nginx)
    fi

    echo -e "${BLUE}Detected sandbox mode: $sandbox_mode${NC}"
    if [ "$sandbox_mode" = "provisioner" ]; then
        echo -e "${BLUE}Provisioner enabled (Kubernetes mode).${NC}"
    else
        echo -e "${BLUE}Provisioner disabled (not required for this sandbox mode).${NC}"
    fi
    echo -e "${BLUE}Using the unified production-style compose stack for local Docker runs.${NC}"
    echo ""
    
    resolve_openagents_home
    echo -e "${BLUE}Using OPENAGENTS_DOCKER_HOST_HOME=$OPENAGENTS_DOCKER_HOST_HOME${NC}"
    echo ""

    echo "Building and starting containers..."
    compose up --build -d --remove-orphans "${services[@]}"
    echo ""
    verify_stack "$DEFAULT_START_TIMEOUT_SECONDS"
    echo ""
    echo "=========================================="
    echo "  OpenAgents Docker is ready"
    echo "=========================================="
    echo ""
    echo "  🌐 App:         http://127.0.0.1:8083"
    echo "  🛠 Admin:       http://127.0.0.1:8081"
    echo "  📦 Sandbox UI:  http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}"
    echo ""
    echo "  📋 View logs: make docker-logs"
    echo "  🛑 Stop:      make docker-stop"
    echo ""
}

# Start only the shared Docker infra used by host-run local development.
infra_start() {
    echo "=========================================="
    echo "  Starting OpenAgents Local Debug Infra"
    echo "=========================================="
    echo ""

    ensure_root_env_file
    resolve_openagents_home

    echo -e "${BLUE}Using OPENAGENTS_DOCKER_HOST_HOME=$OPENAGENTS_DOCKER_HOST_HOME${NC}"
    echo -e "${BLUE}Starting sandbox-aio + ONLYOFFICE from the unified compose file.${NC}"
    echo ""

    compose up -d sandbox-aio onlyoffice

    echo ""
    echo -e "${GREEN}✓ Local debug infra is starting${NC}"
    echo "  Sandbox AIO: http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}"
    echo "  ONLYOFFICE:  http://127.0.0.1:8082"
    echo "  Host app:    run 'make dev' separately"
    echo ""
}

# View Docker stack logs.
logs() {
    local service=""
    
    case "$1" in
        --langgraph)
            service="langgraph"
            echo -e "${BLUE}Viewing langgraph logs...${NC}"
            ;;
        --gateway)
            service="gateway"
            echo -e "${BLUE}Viewing gateway logs...${NC}"
            ;;
        --nginx)
            service="nginx"
            echo -e "${BLUE}Viewing nginx logs...${NC}"
            ;;
        --provisioner)
            service="provisioner"
            echo -e "${BLUE}Viewing provisioner logs...${NC}"
            ;;
        --sandbox-aio)
            service="sandbox-aio"
            echo -e "${BLUE}Viewing sandbox-aio logs...${NC}"
            ;;
        --onlyoffice)
            service="onlyoffice"
            echo -e "${BLUE}Viewing onlyoffice logs...${NC}"
            ;;
        "")
            echo -e "${BLUE}Viewing all logs...${NC}"
            ;;
        *)
            echo -e "${YELLOW}Unknown option: $1${NC}"
            echo "Usage: $0 logs [--langgraph|--gateway|--nginx|--provisioner|--sandbox-aio|--onlyoffice]"
            exit 1
            ;;
    esac
    
    compose logs -f $service
}

# Stop the unified Docker Compose stack.
stop() {
    echo "Stopping Docker services..."
    compose down
    echo -e "${GREEN}✓ Docker services stopped${NC}"
}

# Stop only the shared Docker infra used by host-run local development.
infra_stop() {
    echo "Stopping OpenAgents local debug infra..."
    compose stop sandbox-aio onlyoffice >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Local debug infra stopped${NC}"
}

# Restart the unified Docker Compose stack.
restart() {
    echo "========================================"
    echo "  Restarting OpenAgents Docker Services"
    echo "========================================"
    echo ""
    echo -e "${BLUE}Restarting containers...${NC}"
    compose restart
    echo ""
    verify_stack "$DEFAULT_START_TIMEOUT_SECONDS"
    echo ""
    echo -e "${GREEN}✓ Docker services restarted${NC}"
    echo ""
    echo "  🌐 App:   http://127.0.0.1:8083"
    echo "  🛠 Admin: http://127.0.0.1:8081"
    echo "  📋 View logs: make docker-logs"
    echo ""
}

# Show help
help() {
    echo "OpenAgents Docker Management Script"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  init          - Pull the sandbox image (speeds up first Pod startup)"
    echo "  start         - Start the unified Docker compose stack"
    echo "  infra-start   - Start local debug infra only (sandbox-aio + onlyoffice)"
    echo "  status        - Show current Docker compose status"
    echo "  verify        - Wait for services and verify public HTTP entrypoints"
    echo "  restart       - Restart all running Docker services"
    echo "  logs [option] - View Docker stack logs"
    echo "                  --langgraph  View langgraph logs only"
    echo "                  --gateway    View gateway logs only"
    echo "                  --nginx      View nginx logs only"
    echo "                  --provisioner View provisioner logs only"
    echo "                  --sandbox-aio View sandbox-aio logs only"
    echo "                  --onlyoffice View onlyoffice logs only"
    echo "  stop          - Stop Docker development services"
    echo "  infra-stop    - Stop local debug infra only"
    echo "  help          - Show this help message"
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
