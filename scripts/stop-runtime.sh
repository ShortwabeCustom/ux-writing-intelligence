#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-mac.sh
source "$SCRIPT_DIR/lib-mac.sh"

pid="$(read_pid "$RUNTIME_PID_FILE" 2>/dev/null || true)"
if [[ -z "$pid" ]]; then
  if runtime_health_ok; then
    say "Runtime: READY (not owned by this lifecycle; nothing stopped)"
  else
    say "Runtime: STOPPED (no repository PID)"
  fi
  exit 0
fi

if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$RUNTIME_PID_FILE"
  say "Runtime: STOPPED (removed stale PID)"
  exit 0
fi

runtime_pid_belongs_to_repo "$pid" || fail "PID $pid is not the runtime owned by this repository; nothing was stopped."
kill -TERM "$pid"
for _ in {1..20}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$RUNTIME_PID_FILE"
    say "Runtime: STOPPED"
    exit 0
  fi
  sleep 0.25
done
fail "Runtime PID $pid did not stop after SIGTERM."
