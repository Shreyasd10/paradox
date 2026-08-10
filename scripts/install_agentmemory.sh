#!/usr/bin/env bash
# Install/uninstall agentmemory for paradox Pi / Codex runtimes.
#
# Usage:
#   ./scripts/install_agentmemory.sh install --runtime pi|codex [--scope global|project]
#   ./scripts/install_agentmemory.sh uninstall --runtime pi|codex
#
# Prefer `agentmemory connect <harness> --force` (writes MCP + tips). Failures
# warn and continue. Uninstall does not remove the CLI or memory DB.
set -euo pipefail

MODE="install"
RUNTIME=""
SCOPE="global"
AGENTMEMORY_NPM_SPEC="${AGENTMEMORY_NPM_SPEC:-@agentmemory/agentmemory@^0.9.27}"
AGENTMEMORY_MCP_URL="${AGENTMEMORY_MCP_URL:-http://localhost:3111/mcp}"

while (($#)); do
  case "$1" in
    install|uninstall) MODE="$1"; shift ;;
    --runtime)
      RUNTIME="$2"
      shift 2
      ;;
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

[[ "$RUNTIME" == "pi" || "$RUNTIME" == "codex" ]] || {
  echo "error: --runtime must be pi or codex" >&2
  exit 1
}

resolve_agentmemory_cmd() {
  if command -v agentmemory >/dev/null 2>&1; then
    command -v agentmemory
    return 0
  fi
  local candidate
  for candidate in \
    "$HOME/.npm-global/bin/agentmemory" \
    "$HOME/.local/bin/agentmemory" \
    /usr/local/bin/agentmemory; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

ensure_agentmemory_cli() {
  if resolve_agentmemory_cmd >/dev/null 2>&1; then
    echo "  agentmemory: $(resolve_agentmemory_cmd)"
    return 0
  fi
  echo "  agentmemory not found; attempting npm install..."
  command -v npm >/dev/null 2>&1 || {
    echo "  WARN: npm not found; cannot install agentmemory" >&2
    return 1
  }
  npm install -g "$AGENTMEMORY_NPM_SPEC" >/dev/null 2>&1 \
    || npm install -g @agentmemory/agentmemory >/dev/null 2>&1 \
    || {
      echo "  WARN: npm install @agentmemory/agentmemory failed" >&2
      return 1
    }
  if resolve_agentmemory_cmd >/dev/null 2>&1; then
    echo "  agentmemory installed: $(resolve_agentmemory_cmd)"
    return 0
  fi
  echo "  WARN: agentmemory binary still not on PATH after npm install" >&2
  return 1
}

connect_name_for() {
  case "$1" in
    pi) echo "pi" ;;
    codex) echo "codex" ;;
    *) echo "" ;;
  esac
}

echo "[agentmemory] ($MODE) runtime=$RUNTIME scope=$SCOPE"

if [[ "$MODE" == "uninstall" ]]; then
  echo "  uninstall leaves the agentmemory CLI and memory DB in place"
  echo "  tip: disconnect manually if needed (agentmemory disconnect $(connect_name_for "$RUNTIME"))"
  exit 0
fi

ensure_agentmemory_cli || true
am_cmd="$(resolve_agentmemory_cmd 2>/dev/null || true)"
connect_name="$(connect_name_for "$RUNTIME")"

if [[ -z "$am_cmd" ]]; then
  echo "  WARN: agentmemory CLI unavailable; skip connect" >&2
  echo "  tip: npm install -g $AGENTMEMORY_NPM_SPEC && agentmemory connect $connect_name"
  exit 0
fi

if [[ "$SCOPE" != "global" ]]; then
  echo "  [$RUNTIME] project scope: run manually: agentmemory connect $connect_name"
  exit 0
fi

if "$am_cmd" connect "$connect_name" --force >/dev/null 2>&1; then
  echo "  [$RUNTIME] agentmemory connect $connect_name → ok"
else
  echo "  WARN: [$RUNTIME] agentmemory connect $connect_name failed" >&2
  echo "  tip: keep the service running ($AGENTMEMORY_MCP_URL) and retry:"
  echo "       agentmemory status"
  echo "       agentmemory connect $connect_name --force"
fi

echo "  tip: npx skills add rohitg00/agentmemory -y"
echo "[agentmemory] done."
