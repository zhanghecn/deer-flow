#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
PROD_COMPOSE_FILE="docker-compose.yml"
DEFAULT_SERVICES=(nginx gateway langgraph sandbox-aio onlyoffice openpencil)
DEFAULT_IMAGE_REPOSITORY="zhangxuan2/openagents"
DEFAULT_IMAGE_TAG="latest"
DEFAULT_DOCKER_NETWORK="openagents-prod_openagents"

COMMAND="push"
IMAGE_REGISTRY="${OPENAGENTS_IMAGE_REGISTRY:-docker.io}"
IMAGE_NAMESPACE="${OPENAGENTS_IMAGE_NAMESPACE:-${DOCKERHUB_NAMESPACE:-}}"
IMAGE_REPOSITORY="${OPENAGENTS_IMAGE_REPOSITORY:-${DOCKERHUB_REPOSITORY:-}}"
IMAGE_TAG="${OPENAGENTS_IMAGE_TAG:-}"
DRY_RUN=0
BUILD_BEFORE_PUSH=1
SERVICES=()

usage() {
    cat <<'EOF'
Usage:
  scripts/docker-release.sh [push|build|pull|deploy|config|images] [options]

Commands:
  push      Build release images and push them to the registry (default)
  build     Build release images only
  pull      Pull release images using deploy/docker-compose.yml
  deploy    Pull release images and run docker compose up -d from deploy/
  config    Print the resolved deploy compose config
  images    Print the image refs that will be used

Options:
  --repository <repo>  Docker repository, e.g. zhangxuan2/openagents.
                       Defaults to zhangxuan2/openagents.
  --namespace <name>   Compatibility alias for --repository <name>/openagents.
  --tag <tag>          Base tag. Defaults to latest.
                       Final tags are service-tag pairs, e.g. nginx-latest.
  --registry <host>    Registry host. Defaults to docker.io.
  --service <name>     Limit to a service. Can be repeated.
  --no-build           For push: skip build and only push existing local images.
  --dry-run            Print commands without executing them.
  -h, --help           Show this help.

Examples:
  scripts/docker-release.sh push
  scripts/docker-release.sh push --repository zhangxuan2/openagents --tag v0.1.0
  scripts/docker-release.sh deploy --tag v0.1.0
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
            --namespace)
                [ "$#" -ge 2 ] || fail "--namespace requires a value"
                IMAGE_NAMESPACE="$2"
                IMAGE_REPOSITORY=""
                shift 2
                ;;
            --repository)
                [ "$#" -ge 2 ] || fail "--repository requires a value"
                IMAGE_REPOSITORY="$2"
                shift 2
                ;;
            --tag)
                [ "$#" -ge 2 ] || fail "--tag requires a value"
                IMAGE_TAG="$2"
                shift 2
                ;;
            --registry)
                [ "$#" -ge 2 ] || fail "--registry requires a value"
                IMAGE_REGISTRY="$2"
                shift 2
                ;;
            --service)
                [ "$#" -ge 2 ] || fail "--service requires a value"
                SERVICES+=("$2")
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

resolve_release_identity() {
    if [ -n "$IMAGE_REPOSITORY" ]; then
        IMAGE_REPOSITORY="${IMAGE_REPOSITORY#docker.io/}"
        IMAGE_REPOSITORY="${IMAGE_REPOSITORY#https://}"
        IMAGE_REPOSITORY="${IMAGE_REPOSITORY#http://}"
        IMAGE_REPOSITORY="${IMAGE_REPOSITORY#registry-1.docker.io/}"
    fi

    if [ -z "$IMAGE_REPOSITORY" ] && [ -n "$IMAGE_NAMESPACE" ]; then
        IMAGE_REPOSITORY="${IMAGE_NAMESPACE}/openagents"
    fi
    if [ -z "$IMAGE_REPOSITORY" ]; then
        # Keep the repository/tag default explicit so this repo's normal publish
        # path is one command while still allowing --repository/--tag overrides.
        IMAGE_REPOSITORY="$DEFAULT_IMAGE_REPOSITORY"
    fi

    if [ -z "$IMAGE_TAG" ]; then
        IMAGE_TAG="$DEFAULT_IMAGE_TAG"
    fi
}

selected_services() {
    if [ "${#SERVICES[@]}" -gt 0 ]; then
        printf '%s\n' "${SERVICES[@]}"
        return
    fi
    printf '%s\n' "${DEFAULT_SERVICES[@]}"
}

print_release_summary() {
    local service

    info "Release image settings:"
    echo "  registry:  $IMAGE_REGISTRY"
    echo "  repository: $IMAGE_REPOSITORY"
    echo "  base tag:   $IMAGE_TAG"
    echo ""
    info "Images:"
    while IFS= read -r service; do
        [ -n "$service" ] || continue
        echo "  $(image_ref "$service")"
    done < <(selected_services)
    echo ""
}

image_ref() {
    local service="$1"
    local env_var=""
    local override=""

    case "$service" in
        nginx) env_var="OPENAGENTS_NGINX_IMAGE" ;;
        gateway) env_var="OPENAGENTS_GATEWAY_IMAGE" ;;
        langgraph) env_var="OPENAGENTS_LANGGRAPH_IMAGE" ;;
        sandbox-aio) env_var="OPENAGENTS_SANDBOX_AIO_IMAGE" ;;
        onlyoffice) env_var="OPENAGENTS_ONLYOFFICE_IMAGE" ;;
        openpencil) env_var="OPENAGENTS_OPENPENCIL_IMAGE" ;;
        *) fail "Unknown release service: $service" ;;
    esac

    override="${!env_var:-}"
    if [ -n "$override" ]; then
        echo "$override"
        return
    fi

    echo "${IMAGE_REGISTRY}/${IMAGE_REPOSITORY}:${service}-${IMAGE_TAG}"
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

ensure_docker_network() {
    local network="${OPENAGENTS_DOCKER_NETWORK:-$DEFAULT_DOCKER_NETWORK}"

    if docker network inspect "$network" >/dev/null 2>&1; then
        return
    fi

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
                "$DOCKER_DIR"
            ;;
        onlyoffice)
            run_cmd docker build -t "$image" -f "$PROJECT_ROOT/docker/onlyoffice/Dockerfile" "$DOCKER_DIR"
            ;;
        openpencil)
            run_cmd docker build -t "$image" -f "$PROJECT_ROOT/openpencil/Dockerfile" "$PROJECT_ROOT/openpencil"
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
    OPENAGENTS_IMAGE_REPOSITORY="$IMAGE_REPOSITORY" \
    OPENAGENTS_IMAGE_TAG="$IMAGE_TAG" \
        docker compose -f "$PROD_COMPOSE_FILE" "$@"
}

run_compose_base() {
    # Compose runtime commands intentionally use the generated deploy directory:
    # docker/ remains source-controlled templates, while deploy/ owns local
    # secrets, copied configs, and bind-mounted data paths.
    if [ ! -f "$DEPLOY_DIR/$PROD_COMPOSE_FILE" ]; then
        fail "Missing deploy compose: $DEPLOY_DIR/$PROD_COMPOSE_FILE. Run scripts/docker-deploy.sh first."
    fi

    cd "$DEPLOY_DIR"
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '+ OPENAGENTS_IMAGE_REGISTRY=%q OPENAGENTS_IMAGE_REPOSITORY=%q OPENAGENTS_IMAGE_TAG=%q docker compose -f %q' \
            "$IMAGE_REGISTRY" "$IMAGE_REPOSITORY" "$IMAGE_TAG" "$PROD_COMPOSE_FILE"
        printf ' %q' "$@"
        printf '\n'
        return 0
    fi
    compose_base "$@"
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
    if [ "${#SERVICES[@]}" -gt 0 ]; then
        mapfile -t services < <(selected_services)
        run_compose_base pull "${services[@]}"
        return
    fi
    run_compose_base pull
}

release_deploy() {
    local services
    if [ "${#SERVICES[@]}" -gt 0 ]; then
        mapfile -t services < <(selected_services)
        run_compose_base pull "${services[@]}"
        run_compose_base up -d "${services[@]}"
        return
    fi
    run_compose_base pull
    run_compose_base up -d
}

main() {
    parse_args "$@"
    resolve_release_identity
    print_release_summary

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
            ensure_docker_network
            release_deploy
            ;;
        *)
            fail "Unsupported command: $COMMAND"
            ;;
    esac

    success "Release command completed: $COMMAND"
}

main "$@"
