#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-mac.sh
source "$SCRIPT_DIR/lib-mac.sh"

require_macos_architecture
[[ -x "$RUNTIME_DIR/.venv/bin/uvicorn" ]] || fail "Runtime venv is missing. Run ./scripts/install-mac.sh."

if runtime_health_ok; then
  port_is_loopback_only "$RUNTIME_PORT" || fail "Runtime responds but port $RUNTIME_PORT is not loopback-only."
  say "Runtime: READY (ALREADY READY)"
  say "Runtime URL: $RUNTIME_URL"
  exit 0
fi

if port_is_listening "$RUNTIME_PORT"; then
  fail "Port $RUNTIME_PORT is occupied by a service that is not this healthy runtime."
fi

rm -f "$RUNTIME_PID_FILE"
(
  cd "$RUNTIME_DIR"
  nohup ./scripts/run_local.sh >"$RUNTIME_LOG_FILE" 2>&1 &
  printf '%s\n' "$!" >"$RUNTIME_PID_FILE"
)

pid="$(read_pid "$RUNTIME_PID_FILE")" || fail "Runtime did not create a valid PID file."
for _ in {1..30}; do
  if runtime_health_ok; then
    runtime_pid_belongs_to_repo "$pid" || fail "Runtime PID identity check failed."
    port_is_loopback_only "$RUNTIME_PORT" || fail "Runtime did not bind exclusively to loopback."
    say "Runtime: READY (STARTED)"
    say "Runtime URL: $RUNTIME_URL"
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.5
done

say "Runtime log: $RUNTIME_LOG_FILE" >&2
tail -n 20 "$RUNTIME_LOG_FILE" >&2 || true
fail "Runtime failed to become healthy."
