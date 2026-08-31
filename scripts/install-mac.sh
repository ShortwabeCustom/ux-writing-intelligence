#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-mac.sh
source "$SCRIPT_DIR/lib-mac.sh"

require_macos_architecture
say "UX Writing Intelligence macOS installer"
say "Architecture: $(uname -m)"

configure_brew_path() {
  if command -v brew >/dev/null 2>&1; then
    return
  fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

configure_brew_path
if command -v brew >/dev/null 2>&1; then
  say "Homebrew: FOUND"
else
  say "Homebrew is required and is not installed."
  say "With confirmation, the official installer from brew.sh will run and may request macOS administrator authorization."
  [[ -t 0 ]] || fail "Interactive confirmation is required. Install Homebrew from https://brew.sh and rerun."
  read -r -p "Run the official Homebrew installer now? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || fail "Homebrew installation declined."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  configure_brew_path
  command -v brew >/dev/null 2>&1 || fail "Homebrew installation finished but brew is not on a known path."
  say "Homebrew: INSTALLED"
fi

[[ -s "$REPO_ROOT/dist/code.js" && -s "$REPO_ROOT/dist/ui.html" ]] || fail "Plugin build artifacts are missing."
say "Prebuilt plugin: PASS"

if command -v python3.12 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.12)"
  say "Python 3.12: FOUND ($("$PYTHON_BIN" --version 2>&1))"
else
  say "Python 3.12: INSTALLING with Homebrew"
  brew install python@3.12
  PYTHON_BIN="$(brew --prefix python@3.12)/bin/python3.12"
  [[ -x "$PYTHON_BIN" ]] || fail "Python 3.12 installation failed."
  say "Python 3.12: INSTALLED"
fi
"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' || fail "An exact Python 3.12 interpreter is required."

if [[ -d "$RUNTIME_DIR/.venv" ]]; then
  [[ -x "$RUNTIME_DIR/.venv/bin/python" ]] || fail "runtime/.venv exists but is incomplete. Move it aside and rerun."
  "$RUNTIME_DIR/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' || fail "runtime/.venv uses an incompatible Python. Move it aside and rerun."
  say "Runtime venv: REUSED"
else
  "$PYTHON_BIN" -m venv "$RUNTIME_DIR/.venv"
  say "Runtime venv: CREATED"
fi

requirements_hash="$(shasum -a 256 "$RUNTIME_DIR/requirements.txt" | awk '{print $1}')"
requirements_marker="$RUNTIME_DIR/.venv/.requirements.sha256"
installed_hash="$(sed -n '1p' "$requirements_marker" 2>/dev/null || true)"
if [[ "$requirements_hash" == "$installed_hash" ]] && "$RUNTIME_DIR/.venv/bin/python" -m pip check >/dev/null 2>&1; then
  say "Runtime requirements: REUSED"
else
  "$RUNTIME_DIR/.venv/bin/python" -m pip install -r "$RUNTIME_DIR/requirements.txt"
  "$RUNTIME_DIR/.venv/bin/python" -m pip check
  printf '%s\n' "$requirements_hash" > "$requirements_marker"
  say "Runtime requirements: INSTALLED"
fi

if command -v ollama >/dev/null 2>&1; then
  say "Ollama: FOUND"
else
  say "Ollama: INSTALLING with Homebrew"
  brew install ollama
  export PATH="$(brew --prefix ollama)/bin:$PATH"
  hash -r
  command -v ollama >/dev/null 2>&1 || fail "Ollama installation failed."
  say "Ollama: INSTALLED"
fi

if ollama_ready; then
  port_is_loopback_only "$OLLAMA_PORT" || fail "Ollama is reachable but port $OLLAMA_PORT is not loopback-only."
  say "Ollama service: ALREADY READY"
else
  port_is_listening "$OLLAMA_PORT" && fail "Port $OLLAMA_PORT is occupied by a non-Ollama service."
  say "Ollama service: STARTING on $OLLAMA_HOST:$OLLAMA_PORT"
  (
    cd "$RUNTIME_DIR"
    OLLAMA_HOST="$OLLAMA_HOST:$OLLAMA_PORT" nohup ollama serve >"$OLLAMA_LOG_FILE" 2>&1 &
    printf '%s\n' "$!" >"$OLLAMA_PID_FILE"
  )
  for _ in {1..40}; do
    ollama_ready && break
    sleep 0.5
  done
  ollama_ready || fail "Ollama did not become ready. See $OLLAMA_LOG_FILE."
  port_is_loopback_only "$OLLAMA_PORT" || fail "Ollama did not bind exclusively to loopback."
  say "Ollama service: STARTED"
fi

if model_ready; then
  say "$OLLAMA_MODEL: FOUND"
else
  say "$OLLAMA_MODEL: PULLING from the Ollama registry"
  OLLAMA_HOST="$OLLAMA_HOST:$OLLAMA_PORT" ollama pull "$OLLAMA_MODEL"
  model_ready || fail "$OLLAMA_MODEL was pulled but is not available."
  say "$OLLAMA_MODEL: PULLED"
fi

"$SCRIPT_DIR/start-runtime.sh"
curl --silent --show-error --fail "$RUNTIME_URL/health" >/dev/null
curl --silent --show-error --fail "$RUNTIME_URL/v1/runtime/status" |
  "$RUNTIME_DIR/.venv/bin/python" -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("runtime") == "ready" and d.get("model_available") is True else 1)'

say "Synthetic local analysis: RUNNING"
curl --silent --show-error --fail --max-time 90 \
  -H 'Content-Type: application/json' \
  --data '{"text":"Continuar","context":"Prueba sintética de instalación","locale":"es-MX"}' \
  "$RUNTIME_URL/v1/analyze/text" |
  "$RUNTIME_DIR/.venv/bin/python" -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("text") == "Continuar" and d.get("suggestion") else 1)'
say "Synthetic local analysis: PASS"

"$SCRIPT_DIR/verify-install.sh"

say ""
say "Installation complete."
say "Import this manifest manually in Figma Desktop:"
say "$REPO_ROOT/manifest.json"
say "Figma: Plugins > Development > Import plugin from manifest..."
