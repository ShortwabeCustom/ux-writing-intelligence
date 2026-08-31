#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
PACKAGE_NAME="ux-writing-intelligence-v${VERSION}-macos-arm64"
RELEASE_DIR="$REPO_ROOT/release"
ZIP_PATH="$RELEASE_DIR/$PACKAGE_NAME.zip"
CHECKSUM_PATH="$ZIP_PATH.sha256"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ux-writing-release.XXXXXX")"
STAGING_DIR="$STAGING_ROOT/$PACKAGE_NAME"

cleanup() { rm -rf "$STAGING_ROOT"; }
trap cleanup EXIT

cd "$REPO_ROOT"
[[ "$(git rev-parse --show-toplevel)" == "$REPO_ROOT" ]] || { echo "ERROR: unexpected Git repository." >&2; exit 1; }
case "$(git branch --show-current)" in
  main|feat/no-auth-distribution) ;;
  *) echo "ERROR: release builds are allowed only from main or feat/no-auth-distribution." >&2; exit 1 ;;
esac
dirty="$(git status --porcelain=v1 --untracked-files=all | sed '/^?? release\//d')"
[[ -z "$dirty" ]] || { echo "ERROR: repository must be clean before building a release." >&2; exit 1; }
[[ "$VERSION" == "0.9.4.0" ]] || { echo "ERROR: unexpected VERSION: $VERSION" >&2; exit 1; }
[[ -z "$(git tag --list "v$VERSION")" ]] || { echo "ERROR: final tag v$VERSION already exists." >&2; exit 1; }

echo "Building the plugin from locked dependencies..."
npm ci
npm run typecheck
npm run build

required=(
  manifest.json dist/code.js dist/ui.html INSTALL.md VERSION versions.env
  scripts/install-mac.sh scripts/lib-mac.sh scripts/start-runtime.sh
  scripts/stop-runtime.sh scripts/status-runtime.sh scripts/verify-install.sh
  runtime/requirements.txt runtime/scripts/run_local.sh
  runtime/src/__init__.py runtime/src/analysis_service.py
  runtime/src/boundary_integrity.py runtime/src/config.py runtime/src/glossary.py
  runtime/src/locale_integrity.py runtime/src/main.py runtime/src/models.py
  runtime/src/observability.py runtime/src/ollama_client.py
  runtime/src/orthography.py runtime/src/protected_content.py runtime/src/scoring.py
  runtime/src/semantic_fidelity.py runtime/src/suggestion_quality.py
)

mkdir -p "$STAGING_DIR"
for relative in "${required[@]}"; do
  [[ -s "$REPO_ROOT/$relative" ]] || { echo "ERROR: missing required file: $relative" >&2; exit 1; }
  mkdir -p "$STAGING_DIR/$(dirname "$relative")"
  cp "$REPO_ROOT/$relative" "$STAGING_DIR/$relative"
done

build_commit="$(git rev-parse HEAD)"
cat > "$STAGING_DIR/RELEASE-METADATA.json" <<EOF
{
  "version": "$VERSION",
  "platform": "macos",
  "architecture": "arm64",
  "plugin_id": "1674592820827897160",
  "ollama_model": "qwen3.5:4b",
  "runtime_host": "127.0.0.1",
  "runtime_port": 8787,
  "ollama_host": "127.0.0.1",
  "ollama_port": 11434,
  "build_commit": "$build_commit"
}
EOF

chmod 755 "$STAGING_DIR"/scripts/*.sh "$STAGING_DIR/runtime/scripts/run_local.sh"
chmod 644 "$STAGING_DIR/manifest.json" "$STAGING_DIR/dist/"* "$STAGING_DIR/runtime/requirements.txt" \
  "$STAGING_DIR/runtime/src/"*.py "$STAGING_DIR/INSTALL.md" "$STAGING_DIR/VERSION" \
  "$STAGING_DIR/versions.env" "$STAGING_DIR/RELEASE-METADATA.json"

grep -Eq '"id"[[:space:]]*:[[:space:]]*"1674592820827897160"' "$STAGING_DIR/manifest.json" || { echo "ERROR: plugin ID mismatch." >&2; exit 1; }
grep -Eq '"main"[[:space:]]*:[[:space:]]*"dist/code.js"' "$STAGING_DIR/manifest.json" || { echo "ERROR: manifest main path mismatch." >&2; exit 1; }
grep -Eq '"ui"[[:space:]]*:[[:space:]]*"dist/ui.html"' "$STAGING_DIR/manifest.json" || { echo "ERROR: manifest UI path mismatch." >&2; exit 1; }

[[ ! -e "$STAGING_DIR/src" ]] || { echo "ERROR: plugin development source found." >&2; exit 1; }
for forbidden in .git .github tests e2e reports node_modules .venv venv logs; do
  if find "$STAGING_DIR" -mindepth 1 -name "$forbidden" -print -quit | grep -q .; then
    echo "ERROR: forbidden release path found: $forbidden" >&2
    exit 1
  fi
done
if find "$STAGING_DIR" -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' -o -name '*.log' -o -name '*.pid' \) -print -quit | grep -q .; then
  echo "ERROR: forbidden secret or machine-state file found." >&2
  exit 1
fi

secret_pattern='(ghp_|github_pat_|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|Authorization:[[:space:]]*(Basic|Bearer)[[:space:]]+[A-Za-z0-9+/_.=-]{8,})'
if LC_ALL=C grep -ERIl "$secret_pattern" "$STAGING_DIR" >/dev/null; then
  echo "ERROR: possible credential material found in staged release (values suppressed)." >&2
  exit 1
fi
if LC_ALL=C grep -ERIl '(/Users/|alexisvaldez)' "$STAGING_DIR" >/dev/null; then
  echo "ERROR: developer-specific absolute path found in staged release." >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
rm -f "$ZIP_PATH" "$CHECKSUM_PATH"
TZ=UTC find "$STAGING_DIR" -exec touch -t 198001010000 {} +
(
  cd "$STAGING_ROOT"
  LC_ALL=C find "$PACKAGE_NAME" -type f -print | LC_ALL=C sort | zip -X -q "$ZIP_PATH" -@
)
(cd "$RELEASE_DIR" && shasum -a 256 "$(basename "$ZIP_PATH")" > "$(basename "$CHECKSUM_PATH")")
(cd "$RELEASE_DIR" && shasum -a 256 -c "$(basename "$CHECKSUM_PATH")")

echo "Artifact: $ZIP_PATH"
echo "Checksum: $CHECKSUM_PATH"
