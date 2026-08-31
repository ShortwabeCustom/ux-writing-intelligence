#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-mac.sh
source "$SCRIPT_DIR/lib-mac.sh"

runtime_state="STOPPED"
if runtime_health_ok; then
  if port_is_loopback_only "$RUNTIME_PORT"; then
    runtime_state="READY"
  else
    runtime_state="ERROR"
  fi
elif port_is_listening "$RUNTIME_PORT"; then
  runtime_state="ERROR"
fi

ollama_state="STOPPED"
if ollama_ready; then
  if port_is_loopback_only "$OLLAMA_PORT"; then
    ollama_state="READY"
  else
    ollama_state="ERROR"
  fi
fi

model_state="MISSING"
if [[ "$ollama_state" == "READY" ]] && model_ready; then
  model_state="READY"
fi

say "Runtime:"
say "$runtime_state"
say ""
say "Runtime URL:"
say "$RUNTIME_URL"
say ""
say "Ollama:"
say "$ollama_state"
say ""
say "Model:"
say "$OLLAMA_MODEL $model_state"

[[ "$runtime_state" != "ERROR" && "$ollama_state" != "ERROR" ]]
