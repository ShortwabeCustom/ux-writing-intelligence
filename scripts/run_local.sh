#!/usr/bin/env bash
# Lanzador de desarrollo del runtime local.
#
# Escucha SOLO en 127.0.0.1. No crea LaunchAgent, ni daemon de login, ni
# servicio de Homebrew: el ciclo de vida persistente pertenece a fases
# posteriores. Ctrl+C basta para detenerlo limpiamente.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST="127.0.0.1"
PORT="${UXW_PORT:-8787}"

if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "Falta el entorno virtual. Crea uno con:" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "El puerto $PORT ya está ocupado:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  echo "Detén ese proceso o usa UXW_PORT=<otro> antes de reintentar." >&2
  exit 1
fi

echo "UX Writing Local Runtime -> http://$HOST:$PORT   (Ctrl+C para detener)"
exec .venv/bin/uvicorn src.main:app --host "$HOST" --port "$PORT" --log-level warning
