#!/usr/bin/env bash
set -euo pipefail

BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
TAIL="${OPENAGENTS_LOG_TAIL:-200}"
FOLLOW=1
SERVICES=()

usage() {
    cat <<'EOF'
Usage:
  ./scripts/docker-logs.sh [service ...] [--tail N] [--no-follow]

Examples:
  ./scripts/docker-logs.sh
  ./scripts/docker-logs.sh gateway
  ./scripts/docker-logs.sh langgraph --tail 500
  ./scripts/docker-logs.sh migrate --no-follow

Service aliases:
  web|nginx, api|gateway, agent|langgraph, sandbox|sandbox-aio,
  office|onlyoffice, db|postgres, minio, minio-init, migrate

OpenAgents production logs are Docker compose logs. They are stored by Docker's
json-file log driver with rotation from deploy/docker-compose.yml, not in a
deploy/logs directory.
EOF
}

fail() {
    echo "[ERROR] $*" >&2
    exit 1
}

map_service() {
    case "$1" in
        web|nginx)
            printf 'nginx\n'
            ;;
        api|gateway)
            printf 'gateway\n'
            ;;
        agent|langgraph)
            printf 'langgraph\n'
            ;;
        sandbox|sandbox-aio)
            printf 'sandbox-aio\n'
            ;;
        office|onlyoffice)
            printf 'onlyoffice\n'
            ;;
        db|postgres)
            printf 'postgres\n'
            ;;
        minio|minio-init|migrate)
            printf '%s\n' "$1"
            ;;
        *)
            # Unknown names are passed through so compose can report the exact
            # service-name error instead of this helper hiding it.
            printf '%s\n' "$1"
            ;;
    esac
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            --tail|-n)
                [ "$#" -ge 2 ] || fail "$1 requires a number"
                TAIL="$2"
                shift 2
                ;;
            --no-follow)
                FOLLOW=0
                shift
                ;;
            -*)
                fail "Unknown argument: $1"
                ;;
            *)
                SERVICES+=("$(map_service "$1")")
                shift
                ;;
        esac
    done
}

main() {
    local args

    parse_args "$@"
    args=(logs --tail "$TAIL")

    [ -d "$DEPLOY_DIR" ] || fail "Missing deploy directory: $DEPLOY_DIR"
    [ -f "$DEPLOY_DIR/docker-compose.yml" ] || fail "Missing $DEPLOY_DIR/docker-compose.yml"

    if [ "$FOLLOW" -eq 1 ]; then
        args+=(-f)
    fi
    if [ "${#SERVICES[@]}" -gt 0 ]; then
        args+=("${SERVICES[@]}")
    fi

    echo -e "${BLUE}[INFO]${NC} Reading production logs from deploy/docker-compose.yml"
    (cd "$DEPLOY_DIR" && docker compose -f docker-compose.yml "${args[@]}")
}

main "$@"
