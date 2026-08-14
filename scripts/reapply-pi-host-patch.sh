#!/usr/bin/env bash
# Re-applies the main-chat "Jump to bottom" follow-indicator patch to the
# installed pi host. Run this after `pi update` replaces the global package
# with the same 0.84.1 baseline. Safe to run repeatedly: skips when the
# patch is already present, and refuses to clobber a file that no longer
# matches the known 0.84.1 baseline (e.g. after a version bump — re-baseline
# the patch then).
set -euo pipefail

PATCH_ROOT="${PATCH_ROOT:-$HOME/.pi/local/pi-patch-backup}"
PI_PKG="$HOME/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent"
MODE_JS="$PI_PKG/dist/modes/interactive/interactive-mode.js"
COMPONENT_DIR="$PI_PKG/dist/modes/interactive/components"
COMPONENT_JS="$COMPONENT_DIR/transcript-follow-indicator.js"

if [ ! -f "$MODE_JS" ]; then
  echo "ERROR: pi package not found at $PI_PKG" >&2
  exit 1
fi

if grep -q "routeJumpToEnd" "$MODE_JS"; then
  echo "Patch already applied; nothing to do."
  exit 0
fi

if ! cmp -s "$MODE_JS" "$PATCH_ROOT/interactive-mode.js.original"; then
  echo "ERROR: $MODE_JS differs from the known 0.84.1 baseline." >&2
  echo "pi was probably updated to a different version — re-baseline the patch before applying." >&2
  exit 1
fi

mkdir -p "$COMPONENT_DIR"
cp "$PATCH_ROOT/transcript-follow-indicator.js" "$COMPONENT_JS"
cp "$PATCH_ROOT/interactive-mode.js.patched" "$MODE_JS"
echo "Patch applied. Restart pi to pick it up."
