#!/usr/bin/env bash

# Shared helpers for the non-persistent macOS distribution scripts.

SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_LIB_DIR/.." && pwd)"
RUNTIME_DIR="$REPO_ROOT/runtime"
VERSIONS_FILE="$REPO_ROOT/versions.env"
RUNTIME_URL=""
OLLAMA_URL=""
RUNTIME_PID_FILE="$RUNTIME_DIR/.ux-writing-runtime.pid"
RUNTIME_LOG_FILE="$RUNTIME_DIR/.ux-writing-runtime.log"
OLLAMA_PID_FILE="$RUNTIME_DIR/.ux-writing-ollama.pid"
OLLAMA_LOG_FILE="$RUNTIME_DIR/.ux-writing-ollama.log"

if [[ ! -f "$VERSIONS_FILE" ]]; then
  printf 'Missing installation constants: %s\n' "$VERSIONS_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$VERSIONS_FILE"

RUNTIME_URL="http://${RUNTIME_HOST}:${RUNTIME_PORT}"
OLLAMA_URL="http://${OLLAMA_HOST}:${OLLAMA_PORT}"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_macos_architecture() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "This installer supports macOS only."
  case "$(uname -m)" in
    arm64|x86_64) ;;
    *) fail "Unsupported CPU architecture: $(uname -m). Supported: arm64, x86_64." ;;
  esac
}

listener_names() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n//p'
}

port_is_loopback_only() {
  local port="$1" names name found=0
  names="$(listener_names "$port")"
  [[ -n "$names" ]] || return 1
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    found=1
    case "$name" in
      "127.0.0.1:${port}"|"[::1]:${port}") ;;
      *) return 1 ;;
    esac
  done <<< "$names"
  [[ "$found" -eq 1 ]]
}

port_is_listening() {
  [[ -n "$(listener_names "$1")" ]]
}

runtime_health_ok() {
  curl --silent --show-error --fail --max-time 3 "$RUNTIME_URL/health" 2>/dev/null |
    grep -q '"service":"ux-writing-local-runtime"'
}

runtime_status_ok() {
  curl --silent --show-error --fail --max-time 5 "$RUNTIME_URL/v1/runtime/status" 2>/dev/null |
    grep -q '"runtime":"ready"'
}

ollama_ready() {
  curl --silent --show-error --fail --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1
}

model_ready() {
  ollama_ready || return 1
  command -v ollama >/dev/null 2>&1 || return 1
  OLLAMA_HOST="$OLLAMA_HOST:$OLLAMA_PORT" ollama list 2>/dev/null |
    awk 'NR > 1 {print $1}' | grep -Fxq "$OLLAMA_MODEL"
}

read_pid() {
  local file="$1" pid
  [[ -f "$file" ]] || return 1
  IFS= read -r pid < "$file"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$pid"
}

runtime_pid_belongs_to_repo() {
  local pid="$1" cwd command
  kill -0 "$pid" 2>/dev/null || return 1
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cwd" == "$RUNTIME_DIR" ]] || return 1
  [[ "$command" == *"uvicorn"* && "$command" == *"src.main:app"* ]] || return 1
  lsof -a -p "$pid" -nP -iTCP:"$RUNTIME_PORT" -sTCP:LISTEN >/dev/null 2>&1
}
