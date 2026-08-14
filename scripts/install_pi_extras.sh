#!/usr/bin/env bash
# Install/uninstall pi extras for Paradox: npm extensions, vendored packages
# (packages/pi-task, packages/pi-grok-style-tools, packages/pi-workflows),
# LeanCTX routing, themes, and settings merge.
#
# Usage:
#   ./scripts/install_pi_extras.sh install
#   ./scripts/install_pi_extras.sh uninstall
#   ./scripts/install_pi_extras.sh install --no-lean-ctx
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
MODE="install"
SKIP_LEAN_CTX="false"

PI_EXTENSIONS=(
  "npm:@gotgenes/pi-permission-system"
  "npm:@juicesharp/rpiv-todo"
  "npm:@juicesharp/rpiv-ask-user-question"
  "npm:pi-x-ide"
  "npm:pi-lean-ctx"
  "npm:@narumitw/pi-usage"
  "npm:@mrclrchtr/supi-context"
  "npm:@juicesharp/rpiv-advisor"
)
VENDORED_PACKAGES=(
  "pi-task"
  "pi-grok-style-tools"
  "pi-workflows"
)
LEAN_CTX_NPM_SPEC="${LEAN_CTX_NPM_SPEC:-lean-ctx-bin@^3.9.3}"
LEAN_CTX_PI_CONFIG="$HOME/.pi/agent/extensions/pi-lean-ctx/config.json"
LEAN_CTX_MARKER="$HOME/.pi/agent/extensions/pi-lean-ctx/.paradox-managed"
LEAN_CTX_MANAGED_BY="paradox"

while (($#)); do
  case "$1" in
    install|uninstall) MODE="$1"; shift ;;
    --no-lean-ctx) SKIP_LEAN_CTX="true"; shift ;;
    -h|--help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

ensure_runtime_deps() { # ensure_runtime_deps <package-dir>
  local pkg_dir="$1"
  [[ -f "$pkg_dir/package-lock.json" ]] || return 0
  command -v npm >/dev/null 2>&1 || { echo "  WARN: npm not found; skipping npm ci for $pkg_dir" >&2; return 0; }
  echo "  npm ci --omit=dev in $pkg_dir..."
  ( cd "$pkg_dir" && npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund ) \
    || echo "  WARN: npm ci failed for $pkg_dir" >&2
}

relative_package_entry() { # relative_package_entry <pkg-dir> -> prints entry relative to ~/.pi/agent
  local pkg_dir="$1"
  python3 - "$pkg_dir" "$HOME/.pi/agent" <<'PY'
import os, sys
pkg, pi = map(os.path.abspath, sys.argv[1:3])
print(os.path.relpath(pkg, pi))
PY
}

set_single_package_entry() { # set_single_package_entry <entry>
  local entry="$1"
  node - "$HOME/.pi/agent/settings.json" "$entry" <<'JS'
const fs = require("node:fs");
const [settingsPath, entry] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
settings.packages = settings.packages ?? [];
settings.packages = settings.packages.filter((p) => p !== entry);
settings.packages.push(entry);
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
JS
}

install_vendored_package() {
  local name="$1" pkg_dir="$ROOT_DIR/packages/$name"
  [[ -f "$pkg_dir/package.json" ]] || { echo "  WARN: missing $pkg_dir" >&2; return 0; }
  if [[ "$MODE" == "uninstall" ]]; then
    if command -v pi >/dev/null 2>&1; then
      pi remove "$pkg_dir" >/dev/null 2>&1 \
        || echo "  WARN: pi remove $pkg_dir failed or was not installed" >&2
    fi
    return 0
  fi
  ensure_runtime_deps "$pkg_dir"
  if command -v pi >/dev/null 2>&1; then
    pi install "$pkg_dir" >/dev/null \
      && echo "  installed $name via pi install" \
      || echo "  WARN: pi install $pkg_dir failed" >&2
  else
    echo "  WARN: pi not found; cannot install $name" >&2
    return 0
  fi
  local entry
  entry="$(relative_package_entry "$pkg_dir")"
  set_single_package_entry "$entry"
  echo "  packages entry: $entry"
}

install_pi_extensions() {
  if [[ "$MODE" == "uninstall" ]]; then
    if command -v pi >/dev/null 2>&1; then
      echo "  removing third-party pi extensions via pi..."
      for extension in "${PI_EXTENSIONS[@]}"; do
        pi remove "$extension" >/dev/null 2>&1 \
          || echo "  WARN: pi remove $extension failed or was not installed" >&2
      done
    fi
    for name in "${VENDORED_PACKAGES[@]}"; do
      install_vendored_package "$name"
    done
    if [[ -f "$ROOT_DIR/scripts/install-pi-host-patch-guard.sh" ]]; then
      bash "$ROOT_DIR/scripts/install-pi-host-patch-guard.sh" --uninstall >/dev/null 2>&1 || true
    fi
    return 0
  fi
  command -v pi >/dev/null 2>&1 || {
    echo "  WARN: pi not found in PATH; skipping pi extension install" >&2
    echo "  install pi first: npm install -g --ignore-scripts @earendil-works/pi-coding-agent (or: bun install -g @earendil-works/pi-coding-agent)" >&2
    return 0
  }
  echo "  installing ${#PI_EXTENSIONS[@]} pi extensions via pi..."
  for extension in "${PI_EXTENSIONS[@]}"; do
    pi install "$extension" \
      && echo "  installed $extension" \
      || echo "  WARN: pi install $extension failed" >&2
  done
  for name in "${VENDORED_PACKAGES[@]}"; do
    install_vendored_package "$name"
  done
  # Patched pi host: main-chat "Jump to bottom" follow indicator + launchd
  # guard that re-applies it automatically after every `pi update`.
  if [[ -f "$ROOT_DIR/scripts/install-pi-host-patch-guard.sh" ]]; then
    bash "$ROOT_DIR/scripts/install-pi-host-patch-guard.sh" \
      && echo "  installed pi host jump-to-bottom patch guard" \
      || echo "  WARN: pi host patch guard install failed" >&2
  fi
}

deploy_pi_config() {
  local themes_src="$ROOT_DIR/pi-config/themes"
  local themes_dst="$HOME/.pi/agent/themes"
  local settings_partial="$ROOT_DIR/pi-config/settings.partial.json"
  local settings_dst="$HOME/.pi/agent/settings.json"

  if [[ "$MODE" == "uninstall" ]]; then
    echo "  (pi themes/settings left in place on uninstall)"
    return 0
  fi

  if [[ -d "$themes_src" ]]; then
    mkdir -p "$themes_dst"
    local theme
    for theme in "$themes_src"/*.json; do
      [[ -f "$theme" ]] || continue
      cp "$theme" "$themes_dst/$(basename "$theme")"
      echo "  installed theme $(basename "$theme")"
    done
  fi

  if [[ -f "$settings_partial" ]]; then
    mkdir -p "$(dirname "$settings_dst")"
    if [[ ! -f "$settings_dst" ]]; then
      cp "$settings_partial" "$settings_dst"
      echo "  installed settings.json from settings.partial.json"
    elif command -v node >/dev/null 2>&1; then
      node - "$settings_dst" "$settings_partial" <<'NODE'
const fs = require('fs');
const dst = process.argv[1];
const partial = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const current = JSON.parse(fs.readFileSync(dst, 'utf8'));
function merge(a, b) {
  if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
  return out;
}
fs.writeFileSync(dst, JSON.stringify(merge(current, partial), null, 2) + '\n');
NODE
      echo "  merged settings.partial.json into settings.json"
    else
      echo "  WARN: node not found; skipped settings merge" >&2
    fi
  fi
}

deploy_extension_configs() {
  # per-extension configs that were hand-tuned locally; install if absent,
  # uninstall only when the deployed copy is unchanged.
  local spec
  for spec in \
    "pi-permission-system|$ROOT_DIR/pi-config/extensions/pi-permission-system/config.json" \
    "subagent|$ROOT_DIR/pi-config/extensions/subagent/config.json"; do
    local name src dst
    name="${spec%%|*}"
    src="${spec#*|}"
    dst="$HOME/.pi/agent/extensions/$name/config.json"
    if [[ "$MODE" == "uninstall" ]]; then
      if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
        rm -f "$dst"
        echo "  removed $name config (unchanged)"
      fi
      continue
    fi
    [[ -f "$src" ]] || { echo "  WARN: missing $src" >&2; continue; }
    if [[ -f "$dst" ]]; then
      if ! cmp -s "$src" "$dst"; then
        echo "  WARN: $name config exists and differs; leaving it untouched" >&2
      fi
      continue
    fi
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  installed $name config"
  done
}

deploy_agentmemory_extension() {
  local src="$ROOT_DIR/packages/agentmemory"
  local dst="$HOME/.pi/agent/extensions/agentmemory"
  local settings_dst="$HOME/.pi/agent/settings.json"
  if [[ "$MODE" == "uninstall" ]]; then
    if [[ -d "$dst" ]]; then
      if cmp -s "$src/index.ts" "$dst/index.ts" && cmp -s "$src/security.ts" "$dst/security.ts"; then
        rm -rf "$dst"
        echo "  removed agentmemory extension (unchanged)"
      else
        echo "  leaving modified agentmemory extension in place" >&2
      fi
    fi
    if command -v node >/dev/null 2>&1; then
      node -e "
        const fs = require('fs');
        const p = process.argv[1];
        if (!fs.existsSync(p)) process.exit(0);
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.extensions) {
          j.extensions = j.extensions.filter(e => e !== process.argv[2]);
          fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
        }
      " "$settings_dst" "~/.pi/agent/extensions/agentmemory"
    fi
    return 0
  fi
  [[ -f "$src/index.ts" ]] || { echo "  WARN: missing $src" >&2; return 0; }
  if [[ ! -d "$dst" ]]; then
    mkdir -p "$dst"
    cp "$src/index.ts" "$src/security.ts" "$dst/"
    echo "  installed agentmemory extension"
  else
    echo "  agentmemory extension already present; leaving it"
  fi
  if command -v node >/dev/null 2>&1 && [[ -f "$settings_dst" ]]; then
    node -e "
      const fs = require('fs');
      const p = process.argv[1];
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.extensions = j.extensions ?? [];
      if (!j.extensions.includes(process.argv[2])) j.extensions.push(process.argv[2]);
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    " "$settings_dst" "~/.pi/agent/extensions/agentmemory"
    echo "  settings.extensions += ~/.pi/agent/extensions/agentmemory"
  fi
}

deploy_lean_ctx_user_config() {
  local src="$ROOT_DIR/pi-config/lean-ctx/config.toml"
  local dst="${XDG_CONFIG_HOME:-$HOME/.config}/lean-ctx/config.toml"
  [[ "$MODE" == "install" ]] || return 0
  [[ -f "$src" ]] || { echo "  WARN: missing $src" >&2; return 0; }
  if [[ -f "$dst" ]]; then
    echo "  lean-ctx user config exists; leaving it ($dst)"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "  installed lean-ctx user config (allowlist/paths)"
}

resolve_lean_ctx_cmd() {
  if command -v lean-ctx >/dev/null 2>&1; then
    command -v lean-ctx
    return 0
  fi
  if [[ -x "$HOME/.local/bin/lean-ctx" ]]; then
    echo "$HOME/.local/bin/lean-ctx"
    return 0
  fi
  if [[ -x "$HOME/.npm-global/bin/lean-ctx" ]]; then
    echo "$HOME/.npm-global/bin/lean-ctx"
    return 0
  fi
  return 1
}

ensure_lean_ctx_binary() {
  if resolve_lean_ctx_cmd >/dev/null; then
    echo "  lean-ctx binary: $(resolve_lean_ctx_cmd)"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "  WARN: npm not found; cannot install lean-ctx-bin" >&2
    return 0
  fi
  echo "  installing $LEAN_CTX_NPM_SPEC..."
  npm install -g "$LEAN_CTX_NPM_SPEC" \
    || echo "  WARN: lean-ctx-bin install failed" >&2
}

configure_pi_lean_ctx() {
  if [[ "$MODE" == "uninstall" ]]; then
    if [[ -f "$LEAN_CTX_MARKER" ]]; then
      rm -f "$LEAN_CTX_MARKER" "$LEAN_CTX_PI_CONFIG"
      echo "  removed owned pi-lean-ctx config"
    elif [[ -f "$LEAN_CTX_PI_CONFIG" ]]; then
      # older lean-ctx versions kept managedBy inside the config
      if command -v node >/dev/null 2>&1 && node -e '
        const j=require(process.argv[1]);
        process.exit(j.managedBy===process.argv[2]?0:1)
      ' "$LEAN_CTX_PI_CONFIG" "$LEAN_CTX_MANAGED_BY"; then
        rm -f "$LEAN_CTX_PI_CONFIG"
        echo "  removed owned pi-lean-ctx config"
      else
        echo "  leaving foreign/malformed pi-lean-ctx config untouched"
      fi
    fi
    return 0
  fi
  if [[ "$SKIP_LEAN_CTX" == "true" ]]; then
    echo "  LeanCTX routing skipped (--no-lean-ctx)"
    return 0
  fi
  ensure_lean_ctx_binary
  local cmd
  cmd="$(resolve_lean_ctx_cmd || true)"
  [[ -n "$cmd" ]] || { echo "  WARN: lean-ctx binary unavailable; skip configure" >&2; return 0; }

  mkdir -p "$(dirname "$LEAN_CTX_PI_CONFIG")"
  if [[ -f "$LEAN_CTX_PI_CONFIG" ]] && command -v node >/dev/null 2>&1; then
    if ! node -e '
      const j=require(process.argv[1]);
      if (j.managedBy && j.managedBy !== process.argv[2]) process.exit(2);
      process.exit(0);
    ' "$LEAN_CTX_PI_CONFIG" "$LEAN_CTX_MANAGED_BY"; then
      echo "  WARN: pi-lean-ctx config owned by another product; leaving untouched" >&2
      return 0
    fi
  fi

  # init first: it can rewrite the pi config (newer versions drop managedBy and
  # normalize to env + routeShell); our write + ownership marker must come last.
  "$cmd" init --agent pi >/dev/null 2>&1 \
    || echo "  WARN: lean-ctx init --agent pi failed (continuing)" >&2

  if command -v node >/dev/null 2>&1; then
    node - "$LEAN_CTX_PI_CONFIG" "$cmd" "$LEAN_CTX_MANAGED_BY" "$ROOT_DIR/pi-config/lean-ctx/config.json" <<'NODE'
const fs = require('fs');
const path = process.argv[1];
const binary = process.argv[2];
const managedBy = process.argv[3];
const vendoredPath = process.argv[4];
let vendored = {};
try { vendored = JSON.parse(fs.readFileSync(vendoredPath, 'utf8')); } catch {}
let existing = {};
try { existing = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
const next = {
  mode: existing.mode === 'additive' ? 'additive' : 'replace',
  managedBy,
  binary,
  env: { ...(vendored.env || {}), ...(existing.env || {}) },
  toolProfile: existing.toolProfile || vendored.toolProfile || undefined,
  disableTools: existing.disableTools || vendored.disableTools || undefined,
  toolPrefix: existing.toolPrefix || vendored.toolPrefix || undefined,
  enableMcp: existing.enableMcp !== undefined ? existing.enableMcp : vendored.enableMcp,
};
for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
fs.writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
NODE
    echo "  configured pi-lean-ctx ($LEAN_CTX_PI_CONFIG)"
  else
    echo "  WARN: node not found; skipped pi-lean-ctx config write" >&2
  fi
  : > "$LEAN_CTX_MARKER"
}

echo "Pi extras ($MODE)"
install_pi_extensions
deploy_pi_config
deploy_extension_configs
deploy_agentmemory_extension
configure_pi_lean_ctx
deploy_lean_ctx_user_config
echo "Pi extras done."
