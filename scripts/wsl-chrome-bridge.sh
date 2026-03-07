#!/usr/bin/env bash
set -euo pipefail

STACK_ROOT="${WSL_CHROME_STACK_ROOT:-/tmp/wsl-chrome-bridge}"
LOG_DIR="$STACK_ROOT/logs"
PID_DIR="$STACK_ROOT/pids"

DISPLAY_NUM="${DISPLAY_NUM:-99}"
DISPLAY_VALUE=":${DISPLAY_NUM}"
XVFB_SCREEN="${XVFB_SCREEN:-1920x1080x24}"
VNC_PORT="${VNC_PORT:-5900}"
CDP_PORT="${CDP_PORT:-9222}"
VNC_BIND_ADDRESS="${VNC_BIND_ADDRESS:-127.0.0.1}"
CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-$HOME/.cache/wsl-chrome-profile}"

print_info() {
    echo "[INFO] $*"
}

print_error() {
    echo "[ERROR] $*" >&2
}

has_command() {
    command -v "$1" >/dev/null 2>&1
}

ensure_command() {
    if ! has_command "$1"; then
        print_error "Missing command: $1"
        exit 1
    fi
}

detect_chrome() {
    local bin
    for bin in google-chrome google-chrome-stable chromium-browser chromium; do
        if has_command "$bin"; then
            echo "$bin"
            return 0
        fi
    done
    return 1
}

pid_file_path() {
    echo "$PID_DIR/$1.pid"
}

is_pid_alive() {
    local pid_file="$1"
    if [[ ! -f "$pid_file" ]]; then
        return 1
    fi

    local pid
    pid="$(cat "$pid_file")"
    if [[ -z "$pid" ]]; then
        return 1
    fi

    kill -0 "$pid" >/dev/null 2>&1
}

start_daemon() {
    local name="$1"
    shift

    local pid_file
    pid_file="$(pid_file_path "$name")"
    local log_file="$LOG_DIR/$name.log"

    if is_pid_alive "$pid_file"; then
        print_info "$name already running (pid $(cat "$pid_file"))"
        return 0
    fi

    rm -f "$pid_file"
    nohup "$@" >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
    print_info "Started $name (pid $(cat "$pid_file"))"
}

stop_daemon() {
    local name="$1"
    local pid_file
    pid_file="$(pid_file_path "$name")"

    if ! is_pid_alive "$pid_file"; then
        rm -f "$pid_file"
        print_info "$name not running"
        return 0
    fi

    local pid
    pid="$(cat "$pid_file")"
    kill "$pid" >/dev/null 2>&1 || true

    local i
    for i in {1..20}; do
        if ! kill -0 "$pid" >/dev/null 2>&1; then
            break
        fi
        sleep 0.2
    done

    if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
    fi

    rm -f "$pid_file"
    print_info "Stopped $name"
}

show_status() {
    local name="$1"
    local pid_file
    pid_file="$(pid_file_path "$name")"
    if is_pid_alive "$pid_file"; then
        echo "$name: running (pid $(cat "$pid_file"))"
    else
        echo "$name: stopped"
    fi
}

install_deps() {
    ensure_command sudo
    ensure_command curl
    ensure_command gpg

    if [[ ! -f /etc/debian_version ]]; then
        print_error "Only Ubuntu/Debian is supported by this installer."
        exit 1
    fi

    print_info "Installing Xvfb/VNC desktop dependencies"
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg xvfb x11vnc fluxbox

    if detect_chrome >/dev/null 2>&1; then
        print_info "Chrome is already installed"
        return 0
    fi

    local keyring="/usr/share/keyrings/google-linux-signing-keyring.gpg"
    local source_file="/etc/apt/sources.list.d/google-chrome.list"

    if [[ ! -f "$keyring" ]]; then
        print_info "Adding Google Chrome apt key"
        curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
            | gpg --dearmor \
            | sudo tee "$keyring" >/dev/null
    fi

    if [[ ! -f "$source_file" ]]; then
        print_info "Adding Google Chrome apt source"
        echo "deb [arch=amd64 signed-by=$keyring] http://dl.google.com/linux/chrome/deb/ stable main" \
            | sudo tee "$source_file" >/dev/null
    fi

    print_info "Installing google-chrome-stable"
    sudo apt-get update
    sudo apt-get install -y google-chrome-stable
}

wait_for_cdp() {
    local endpoint="http://127.0.0.1:${CDP_PORT}/json/version"
    local i
    for i in {1..40}; do
        if curl -fsS "$endpoint" >/dev/null 2>&1; then
            print_info "CDP endpoint ready: $endpoint"
            return 0
        fi
        sleep 0.25
    done

    print_error "CDP endpoint did not become ready: $endpoint"
    print_error "Check logs: $LOG_DIR/chrome.log"
    exit 1
}

start_stack() {
    ensure_command curl
    ensure_command Xvfb
    ensure_command fluxbox
    ensure_command x11vnc

    local chrome_bin
    if ! chrome_bin="$(detect_chrome)"; then
        print_error "Chrome not found. Run: $0 install"
        exit 1
    fi

    mkdir -p "$LOG_DIR" "$PID_DIR" "$CHROME_PROFILE_DIR"

    start_daemon xvfb Xvfb "$DISPLAY_VALUE" -screen 0 "$XVFB_SCREEN" -ac
    sleep 0.5

    start_daemon fluxbox env DISPLAY="$DISPLAY_VALUE" fluxbox
    sleep 0.5

    start_daemon vnc x11vnc \
        -display "$DISPLAY_VALUE" \
        -rfbport "$VNC_PORT" \
        -listen "$VNC_BIND_ADDRESS" \
        -forever \
        -shared \
        -nopw
    sleep 0.5

    start_daemon chrome env DISPLAY="$DISPLAY_VALUE" "$chrome_bin" \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="$CDP_PORT" \
        --user-data-dir="$CHROME_PROFILE_DIR" \
        --no-first-run \
        --no-default-browser-check \
        --disable-dev-shm-usage \
        --no-sandbox \
        about:blank

    wait_for_cdp

    echo
    echo "=== WSL Chrome Bridge Ready ==="
    echo "Display: $DISPLAY_VALUE"
    echo "CDP endpoint (WSL): http://127.0.0.1:${CDP_PORT}"
    echo "VNC from Windows: localhost:${VNC_PORT}"
    if [[ "$VNC_BIND_ADDRESS" != "127.0.0.1" ]]; then
        local wsl_ip="unknown"
        if has_command hostname; then
            wsl_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
        fi
        echo "VNC fallback: ${wsl_ip}:${VNC_PORT}"
    fi
    echo "Logs: $LOG_DIR"
    echo
}

stop_stack() {
    stop_daemon chrome
    stop_daemon vnc
    stop_daemon fluxbox
    stop_daemon xvfb
}

check_endpoint() {
    ensure_command curl
    local endpoint="http://127.0.0.1:${CDP_PORT}/json/version"
    curl -fsS "$endpoint"
}

show_help() {
    cat <<EOF
WSL Chrome Bridge

Usage:
  $0 install   Install Chrome + Xvfb + x11vnc + fluxbox (Ubuntu/Debian)
  $0 start     Start virtual desktop + VNC + Chrome CDP
  $0 stop      Stop all processes started by this script
  $0 status    Show process status
  $0 check     Curl CDP endpoint
  $0 help      Show this message

Environment overrides:
  DISPLAY_NUM         Default: 99
  XVFB_SCREEN         Default: 1920x1080x24
  VNC_PORT            Default: 5900
  CDP_PORT            Default: 9222
  VNC_BIND_ADDRESS    Default: 127.0.0.1
  CHROME_PROFILE_DIR  Default: \$HOME/.cache/wsl-chrome-profile

Playwright example:
  const browser = await chromium.connectOverCDP('http://127.0.0.1:${CDP_PORT}');
EOF
}

main() {
    local command="${1:-help}"
    case "$command" in
        install)
            install_deps
            ;;
        start)
            start_stack
            ;;
        stop)
            stop_stack
            ;;
        status)
            show_status xvfb
            show_status fluxbox
            show_status vnc
            show_status chrome
            ;;
        check)
            check_endpoint
            ;;
        help|-h|--help)
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "${1:-help}"
