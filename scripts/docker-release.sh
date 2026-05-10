#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
PROD_COMPOSE_FILE="docker-compose.yml"
DEFAULT_SERVICES=(nginx gateway langgraph sandbox-aio onlyoffice)
DEFAULT_IMAGE_PREFIX="zhangxuan2/openagents"
DEFAULT_VERSION="latest"
DEFAULT_DOCKER_NETWORK="openagents"

COMMAND="push"
IMAGE_REGISTRY="${OPENAGENTS_IMAGE_REGISTRY:-}"
IMAGE_PREFIX="${OPENAGENTS_IMAGE_PREFIX:-}"
IMAGE_VERSION="${OPENAGENTS_VERSION:-}"
DRY_RUN=0
BUILD_BEFORE_PUSH=1
SCOPE=""

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-release.sh [push|build|pull|deploy|config|images] --scope <scope> [options]

Commands:
  push      Build release images and push them to the registry (default)
  build     Build release images only
  pull      Pull release images using deploy/docker-compose.yml
  deploy    Pull, run reviewed migrations, then restart the selected services
  config    Print the resolved deploy compose config
  images    Print the image refs that will be used

Options:
  --prefix <prefix>      Image name prefix. Defaults to zhangxuan2/openagents.
                         gateway => <registry>/<prefix>-gateway:<version>
  --version <version>    Image version tag. Defaults to latest.
  --registry <host>      Registry host. Defaults to docker.io.
  --scope <scope>        frontend, gateway, app, or all.
                         frontend=web/nginx; gateway=gateway; app=web+gateway+langgraph.
  --no-build             For push: skip build and only push existing local images.
  --dry-run              Print commands without executing them.
  -h, --help             Show this help.

Examples:
  scripts/docker-release.sh push --scope app --version 1.2.3
  scripts/docker-release.sh deploy --scope gateway --version 1.2.3
  scripts/docker-release.sh deploy --scope all --version 1.2.3
EOF
}

fail() {
    echo -e "${RED}✗ $*${NC}" >&2
    exit 1
}

info() {
    echo -e "${BLUE}$*${NC}"
}

success() {
    echo -e "${GREEN}✓ $*${NC}"
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            push|build|pull|deploy|config|images)
                COMMAND="$1"
                shift
                ;;
            --prefix)
                [ "$#" -ge 2 ] || fail "$1 requires a value"
                IMAGE_PREFIX="$2"
                shift 2
                ;;
            --version)
                [ "$#" -ge 2 ] || fail "$1 requires a value"
                IMAGE_VERSION="$2"
                shift 2
                ;;
            --registry)
                [ "$#" -ge 2 ] || fail "--registry requires a value"
                IMAGE_REGISTRY="$2"
                shift 2
                ;;
            --scope)
                [ "$#" -ge 2 ] || fail "--scope requires a value"
                SCOPE="$2"
                shift 2
                ;;
            --no-build)
                BUILD_BEFORE_PUSH=0
                shift
                ;;
            --dry-run)
                DRY_RUN=1
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

command_requires_scope() {
    case "$COMMAND" in
        push|build|pull|deploy|images)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

validate_release_scope() {
    if command_requires_scope && [ -z "$SCOPE" ]; then
        fail "$COMMAND requires --scope frontend|gateway|app|all"
    fi

    if ! command_requires_scope && [ -n "$SCOPE" ]; then
        fail "--scope only applies to push, build, pull, deploy, or images"
    fi

    case "$SCOPE" in
        ""|frontend|gateway|app|all)
            ;;
        *)
            fail "Unknown release scope: $SCOPE (expected frontend, gateway, app, or all)"
            ;;
    esac
}

resolve_release_identity() {
    if [ -z "$IMAGE_REGISTRY" ]; then
        IMAGE_REGISTRY="$(deploy_env_value OPENAGENTS_IMAGE_REGISTRY || true)"
        IMAGE_REGISTRY="${IMAGE_REGISTRY:-docker.io}"
    fi

    IMAGE_REGISTRY="${IMAGE_REGISTRY#https://}"
    IMAGE_REGISTRY="${IMAGE_REGISTRY#http://}"
    IMAGE_REGISTRY="${IMAGE_REGISTRY%/}"

    if [ -z "$IMAGE_PREFIX" ]; then
        IMAGE_PREFIX="$(deploy_env_value OPENAGENTS_IMAGE_PREFIX || true)"
    fi
    if [ -z "$IMAGE_PREFIX" ]; then
        # One prefix plus one version matches the deploy/.env contract and keeps
        # service identity in the image name instead of in tags like gateway-v1.
        IMAGE_PREFIX="$DEFAULT_IMAGE_PREFIX"
    fi

    IMAGE_PREFIX="${IMAGE_PREFIX#docker.io/}"
    IMAGE_PREFIX="${IMAGE_PREFIX#registry-1.docker.io/}"
    IMAGE_PREFIX="${IMAGE_PREFIX%/}"

    if [ -z "$IMAGE_VERSION" ]; then
        IMAGE_VERSION="$(deploy_env_value OPENAGENTS_VERSION || true)"
    fi
    if [ -z "$IMAGE_VERSION" ]; then
        IMAGE_VERSION="$DEFAULT_VERSION"
    fi
}

selected_services() {
    case "$SCOPE" in
        frontend)
            printf '%s\n' nginx
            ;;
        gateway)
            printf '%s\n' gateway
            ;;
        app)
            printf '%s\n' nginx gateway langgraph
            ;;
        all)
            printf '%s\n' "${DEFAULT_SERVICES[@]}"
            ;;
        *)
            fail "Missing release scope"
            ;;
    esac
}

scope_services_csv() {
    local service separator=""
    while IFS= read -r service; do
        [ -n "$service" ] || continue
        printf '%s%s' "$separator" "$service"
        separator=","
    done < <(selected_services)
}

image_suffix() {
    case "$1" in
        nginx) echo "web" ;;
        gateway) echo "gateway" ;;
        langgraph) echo "langgraph" ;;
        sandbox-aio) echo "sandbox-aio" ;;
        onlyoffice) echo "onlyoffice" ;;
        *) fail "Unknown release service: $1" ;;
    esac
}

image_ref() {
    local service="$1"
    local suffix

    suffix="$(image_suffix "$service")"
    echo "${IMAGE_REGISTRY}/${IMAGE_PREFIX}-${suffix}:${IMAGE_VERSION}"
}

print_release_summary() {
    local service

    info "Release image settings:"
    echo "  registry: $IMAGE_REGISTRY"
    echo "  prefix:   $IMAGE_PREFIX"
    echo "  version:  $IMAGE_VERSION"
    if command_requires_scope; then
        echo "  scope:    $SCOPE"
        echo "  services: $(scope_services_csv)"
        echo ""
        info "Images:"
        while IFS= read -r service; do
            [ -n "$service" ] || continue
            echo "  $(image_ref "$service")"
        done < <(selected_services)
    fi
    echo ""
}

run_cmd() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '+'
        printf ' %q' "$@"
        printf '\n'
        return 0
    fi

    "$@"
}

deploy_env_value() {
    local key="$1"
    local env_file="$DEPLOY_DIR/.env"
    local line=""
    [ -f "$env_file" ] || return
    line="$(grep "^${key}=" "$env_file" | tail -n 1 || true)"
    [ -n "$line" ] || return
    printf '%s\n' "${line#*=}"
}

ensure_docker_network() {
    local network="${OPENAGENTS_DOCKER_NETWORK:-}"
    if [ -z "$network" ]; then
        network="$(deploy_env_value OPENAGENTS_DOCKER_NETWORK || true)"
    fi
    network="${network:-$DEFAULT_DOCKER_NETWORK}"

    if docker network inspect "$network" >/dev/null 2>&1; then
        return
    fi

    # The deploy compose marks the bridge external so a New API container can
    # keep a stable `model-gateway` alias across OpenAgents upgrades.
    run_cmd docker network create "$network"
}

build_service() {
    local service="$1"
    local image
    image="$(image_ref "$service")"

    case "$service" in
        nginx)
            run_cmd docker build -t "$image" -f "$PROJECT_ROOT/docker/nginx/Dockerfile.prod" "$PROJECT_ROOT"
            ;;
        gateway)
            run_cmd docker build -t "$image" -f "$PROJECT_ROOT/backend/gateway/Dockerfile" "$PROJECT_ROOT"
            ;;
        langgraph)
            run_cmd docker build -t "$image" -f "$PROJECT_ROOT/backend/agents/Dockerfile" "$PROJECT_ROOT"
            ;;
        sandbox-aio)
            run_cmd docker build \
                --build-arg "BASE_IMAGE=${OPENAGENTS_SANDBOX_BASE_IMAGE:-enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest}" \
                -t "$image" \
                -f "$PROJECT_ROOT/docker/sandbox-aio/Dockerfile" \
                "$PROJECT_ROOT/docker"
            ;;
        onlyoffice)
            run_cmd docker build -t "$image" -f "$PROJECT_ROOT/docker/onlyoffice/Dockerfile" "$PROJECT_ROOT/docker"
            ;;
        *)
            fail "Unknown release service: $service"
            ;;
    esac
}

push_service() {
    local service="$1"
    run_cmd docker push "$(image_ref "$service")"
}

compose_base() {
    OPENAGENTS_IMAGE_REGISTRY="$IMAGE_REGISTRY" \
    OPENAGENTS_IMAGE_PREFIX="$IMAGE_PREFIX" \
    OPENAGENTS_VERSION="$IMAGE_VERSION" \
        docker compose -f "$PROD_COMPOSE_FILE" "$@"
}

run_compose_base() {
    if [ ! -f "$DEPLOY_DIR/$PROD_COMPOSE_FILE" ]; then
        fail "Missing deploy compose: $DEPLOY_DIR/$PROD_COMPOSE_FILE"
    fi

    cd "$DEPLOY_DIR"
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '+ OPENAGENTS_IMAGE_REGISTRY=%q OPENAGENTS_IMAGE_PREFIX=%q OPENAGENTS_VERSION=%q docker compose -f %q' \
            "$IMAGE_REGISTRY" "$IMAGE_PREFIX" "$IMAGE_VERSION" "$PROD_COMPOSE_FILE"
        printf ' %q' "$@"
        printf '\n'
        return 0
    fi
    compose_base "$@"
}

sync_deploy_assets() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '+ %q --prepare-only\n' "$PROJECT_ROOT/scripts/docker-deploy.sh"
        return
    fi

    "$PROJECT_ROOT/scripts/docker-deploy.sh" --prepare-only
}

scope_needs_migrations() {
    case "$SCOPE" in
        gateway|app|all)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

run_migrations_if_needed() {
    if ! scope_needs_migrations; then
        return
    fi

    # Run the idempotent migration service explicitly before no-deps service
    # restarts; Compose dependency conditions are not re-run for unchanged
    # one-shot containers.
    run_compose_base up -d postgres
    run_compose_base run --rm migrate
}

release_build() {
    local services service
    mapfile -t services < <(selected_services)
    for service in "${services[@]}"; do
        build_service "$service"
    done
}

release_push() {
    local services service
    mapfile -t services < <(selected_services)
    if [ "$BUILD_BEFORE_PUSH" -eq 1 ]; then
        for service in "${services[@]}"; do
            build_service "$service"
        done
    fi
    for service in "${services[@]}"; do
        push_service "$service"
    done
}

release_pull() {
    local services

    if [ "$SCOPE" != "all" ]; then
        mapfile -t services < <(selected_services)
        run_compose_base pull "${services[@]}"
        return
    fi
    run_compose_base pull
}

release_deploy() {
    local services

    sync_deploy_assets
    ensure_docker_network
    release_pull
    run_migrations_if_needed

    if [ "$SCOPE" != "all" ]; then
        mapfile -t services < <(selected_services)
        run_compose_base up -d --no-deps "${services[@]}"
        return
    fi

    run_compose_base up -d
}

main() {
    parse_args "$@"
    validate_release_scope
    resolve_release_identity
    if [ "$COMMAND" != "config" ]; then
        print_release_summary
    fi

    case "$COMMAND" in
        images)
            return 0
            ;;
        config)
            run_compose_base config
            ;;
        build)
            release_build
            ;;
        push)
            release_push
            ;;
        pull)
            release_pull
            ;;
        deploy)
            release_deploy
            ;;
        *)
            fail "Unsupported command: $COMMAND"
            ;;
    esac

    success "Release command completed: $COMMAND"
}

main "$@"
