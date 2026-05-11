#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

REPO_URL="${OPENAGENTS_REPO_URL:-https://github.com/bytedance/openagents.git}"
INSTALL_DIR="${OPENAGENTS_INSTALL_DIR:-$PWD/openagents}"
BRANCH="${OPENAGENTS_BRANCH:-}"

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

clone_or_update_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Updating existing source tree: $INSTALL_DIR"
        git -C "$INSTALL_DIR" fetch --tags origin
        if [ -n "$BRANCH" ]; then
            git -C "$INSTALL_DIR" checkout "$BRANCH"
            git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
            return
        fi
        git -C "$INSTALL_DIR" pull --ff-only
        return
    fi

    if [ -e "$INSTALL_DIR" ]; then
        fail "$INSTALL_DIR already exists but is not a git repository"
    fi

    info "Cloning OpenAgents source into $INSTALL_DIR"
    if [ -n "$BRANCH" ]; then
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    else
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
}

main() {
    echo ""
    echo "=========================================="
    echo "  OpenAgents One-Line Docker Install"
    echo "=========================================="
    echo ""

    require_command git
    require_command docker
    docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

    clone_or_update_repo

    # The repository deploy script owns secret generation, migrations, network
    # setup, optional New API attachment, and startup. This wrapper exists only
    # to make the public self-hosting entrypoint one command.
    "$INSTALL_DIR/scripts/docker-deploy.sh"

    echo ""
    success "OpenAgents is ready"
    echo "  Admin: http://127.0.0.1:8081"
    echo "  App:   http://127.0.0.1:8083"
    echo "  Default admin: admin / admin123"
    echo "  New API sync URL: http://model-gateway:3000"
    echo "  Logs:  $INSTALL_DIR/scripts/docker-logs.sh"
    echo ""
    warn "Keep $INSTALL_DIR/deploy/.env and $INSTALL_DIR/deploy/data/ when backing up or migrating."
}

main "$@"
