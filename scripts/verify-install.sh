#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-mac.sh
source "$SCRIPT_DIR/lib-mac.sh"

checks=0
failures=0

check() {
  local label="$1"
  shift
  checks=$((checks + 1))
  if "$@"; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    failures=$((failures + 1))
  fi
}

is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }
supported_arch() { [[ "$(uname -m)" == "arm64" || "$(uname -m)" == "x86_64" ]]; }
node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(`.`)[0]')" -ge "$NODE_REQUIRED_MAJOR" ]]; }
npm_ok() { command -v npm >/dev/null; }
plugin_deps_ok() { (cd "$REPO_ROOT" && npm ls --depth=0 >/dev/null 2>&1); }
plugin_build_ok() { [[ -s "$REPO_ROOT/dist/code.js" && -s "$REPO_ROOT/dist/ui.html" ]]; }
manifest_ok() { [[ -f "$REPO_ROOT/manifest.json" ]]; }
plugin_id_ok() { grep -Eq '"id"[[:space:]]*:[[:space:]]*"1674592820827897160"' "$REPO_ROOT/manifest.json"; }
python_ok() { [[ -x "$RUNTIME_DIR/.venv/bin/python" ]] && "$RUNTIME_DIR/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)'; }
runtime_deps_ok() { "$RUNTIME_DIR/.venv/bin/python" -m pip check >/dev/null 2>&1 && "$RUNTIME_DIR/.venv/bin/python" -c 'import fastapi,httpx,pydantic,uvicorn'; }
ollama_installed() { command -v ollama >/dev/null; }
runtime_listener_ok() { runtime_health_ok && port_is_loopback_only "$RUNTIME_PORT"; }
runtime_api_ok() { runtime_status_ok; }

check "macOS" is_macos
check "architecture $(uname -m)" supported_arch
check "Node >= $NODE_REQUIRED_MAJOR" node_ok
check "npm" npm_ok
check "plugin dependencies" plugin_deps_ok
check "plugin build artifacts" plugin_build_ok
check "manifest present" manifest_ok
check "plugin ID unchanged" plugin_id_ok
check "Python 3.12 runtime venv" python_ok
check "runtime dependencies" runtime_deps_ok
check "Ollama installed" ollama_installed
check "Ollama available" ollama_ready
check "Ollama loopback-only" port_is_loopback_only "$OLLAMA_PORT"
check "$OLLAMA_MODEL available" model_ready
check "runtime health and loopback-only" runtime_listener_ok
check "runtime status ready" runtime_api_ok

printf '\nVerification: %d checks, %d failures\n' "$checks" "$failures"
[[ "$failures" -eq 0 ]]
