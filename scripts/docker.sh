#!/usr/bin/env bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
ROOT_ENV_FILE="$PROJECT_ROOT/.env"
DEFAULT_SANDBOX_AIO_IMAGE="enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest"
DEFAULT_SANDBOX_AIO_PORT="8083"

# Docker Compose arguments. Use the shared root `.env` as the single app config.
COMPOSE_ARGS=(--env-file "$ROOT_ENV_FILE" -p openagents-dev -f docker-compose-dev.yaml)

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

container_exists_by_name() {
    local name="$1"
    [ -n "$(docker ps -aq --filter "name=^/${name}$" 2>/dev/null)" ]
}

container_running_by_name() {
    local name="$1"
    [ -n "$(docker ps -q --filter "name=^/${name}$" 2>/dev/null)" ]
}

ensure_infra_service() {
    local service="$1"
    local container_name="$2"

    if container_running_by_name "$container_name"; then
        echo -e "${GREEN}Reusing running container: $container_name${NC}"
        return
    fi

    if container_exists_by_name "$container_name"; then
        echo -e "${BLUE}Starting existing container: $container_name${NC}"
        docker start "$container_name" >/dev/null
        return
    fi

    echo -e "${BLUE}Creating container for service: $service${NC}"
    (
        cd "$DOCKER_DIR" &&
        docker compose "${COMPOSE_ARGS[@]}" up --build -d "$service"
    )
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

# Start Docker development environment
start() {
    local sandbox_mode
    local -a services

    echo "=========================================="
    echo "  Starting OpenAgents Docker Development"
    echo "=========================================="
    echo ""

    ensure_root_env_file

    sandbox_mode="$(detect_sandbox_mode)"

    if [ "$sandbox_mode" = "provisioner" ]; then
        require_provisioner_env
        services=(frontend gateway onlyoffice langgraph provisioner nginx)
    elif [ "$sandbox_mode" = "aio" ]; then
        services=(sandbox-aio frontend gateway onlyoffice langgraph nginx)
    else
        services=(frontend gateway onlyoffice langgraph nginx)
    fi

    echo -e "${BLUE}Detected sandbox mode: $sandbox_mode${NC}"
    if [ "$sandbox_mode" = "provisioner" ]; then
        echo -e "${BLUE}Provisioner enabled (Kubernetes mode).${NC}"
    else
        echo -e "${BLUE}Provisioner disabled (not required for this sandbox mode).${NC}"
    fi
    echo -e "${BLUE}ONLYOFFICE enabled in the Docker dev stack.${NC}"
    echo ""
    
    resolve_openagents_home
    echo -e "${BLUE}Using OPENAGENTS_DOCKER_HOST_HOME=$OPENAGENTS_DOCKER_HOST_HOME${NC}"
    echo ""

    echo "Building and starting containers..."
    cd "$DOCKER_DIR" && docker compose "${COMPOSE_ARGS[@]}" up --build -d --remove-orphans "${services[@]}"
    echo ""
    echo "=========================================="
    echo "  OpenAgents Docker is starting!"
    echo "=========================================="
    echo ""
    echo "  🌐 Application: http://localhost:2026"
    echo "  📡 API Gateway: http://localhost:2026/api/*"
    echo "  🤖 LangGraph:   http://localhost:2026/api/langgraph/*"
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
    echo -e "${BLUE}Starting shared sandbox + ONLYOFFICE only.${NC}"
    echo ""

    ensure_infra_service "sandbox-aio" "openagents-aio-sandbox"
    ensure_infra_service "onlyoffice" "openagents-onlyoffice"

    echo ""
    echo -e "${GREEN}✓ Local debug infra is starting${NC}"
    echo "  Sandbox AIO: http://127.0.0.1:${DEFAULT_SANDBOX_AIO_PORT}"
    echo "  ONLYOFFICE:  http://127.0.0.1:${ONLYOFFICE_PORT:-8082}"
    echo "  Host app:    run 'make dev' separately"
    echo ""
}

# View Docker development logs
logs() {
    local service=""
    
    case "$1" in
        --frontend)
            service="frontend"
            echo -e "${BLUE}Viewing frontend logs...${NC}"
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
            echo "Usage: $0 logs [--frontend|--gateway|--nginx|--provisioner|--sandbox-aio|--onlyoffice]"
            exit 1
            ;;
    esac
    
    cd "$DOCKER_DIR" && docker compose "${COMPOSE_ARGS[@]}" logs -f $service
}

# Stop Docker development environment
stop() {
    echo "Stopping Docker development services..."
    cd "$DOCKER_DIR" && docker compose "${COMPOSE_ARGS[@]}" down
    echo -e "${GREEN}✓ Docker services stopped${NC}"
}

# Stop only the shared Docker infra used by host-run local development.
infra_stop() {
    echo "Stopping OpenAgents local debug infra..."
    docker stop openagents-aio-sandbox openagents-onlyoffice >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Local debug infra stopped${NC}"
}

# Restart Docker development environment
restart() {
    echo "========================================"
    echo "  Restarting OpenAgents Docker Services"
    echo "========================================"
    echo ""
    echo -e "${BLUE}Restarting containers...${NC}"
    cd "$DOCKER_DIR" && docker compose "${COMPOSE_ARGS[@]}" restart
    echo ""
    echo -e "${GREEN}✓ Docker services restarted${NC}"
    echo ""
    echo "  🌐 Application: http://localhost:2026"
    echo "  📋 View logs: make docker-dev-logs"
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
    echo "  start         - Start Docker services (auto-detects sandbox mode from startup config)"
    echo "  infra-start   - Start local debug infra only (sandbox-aio + onlyoffice)"
    echo "  restart       - Restart all running Docker services"
    echo "  logs [option] - View Docker development logs"
    echo "                  --frontend   View frontend logs only"
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
