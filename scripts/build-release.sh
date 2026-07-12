#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source "${XDG_CONFIG_HOME:-$HOME/.config}/halloweed/load-apple-release-env.sh"

# Load .env (handles values with spaces)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Read key contents from file path
if [ -f "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY")"
fi

# Clean previous bundle
rm -rf src-tauri/target/release/bundle

# Build the signed .app and updater artifacts with Tauri, then build the DMG
# with Lutin for the cleaner installer layout.
bun tauri build --bundles app "$@"

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  lutin notary setup \
    --profile lutin-notary \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_PASSWORD"
fi

lutin release --config lutin.yml

echo ""
echo "✓ Build complete! Output:"
ls -la src-tauri/target/release/bundle/lutin/*.dmg 2>/dev/null || true
ls -la src-tauri/target/release/bundle/macos/*.app
