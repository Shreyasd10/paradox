#!/usr/bin/env bash
# Paradox — pi with batteries. Installs skills, agents, rules (playbook →
# APPEND_SYSTEM.md), templates, themes, settings, and extension packages
# (npm + the vendored packages under packages/) for pi.
#
# Usage: ./install.sh [--global|--project-local] [options]
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
SCOPE=""
PROJECT_DIR="$(pwd -P)"
DRY_RUN=0
VERIFY=0
UNINSTALL=0
SKIP_EXTENSIONS=0
SKIP_LEAN_CTX=0
WITH_AGENTMEMORY=0

usage() {
  cat <<'EOF'
Usage: ./install.sh (--global|--project-local) [options]

Options:
  --global              Install into pi's user directories (~/.pi/...).
  --project-local       Install into project-local directories (.pi/...).
  --project-dir PATH    Project root for --project-local (default: current directory).
  --dry-run             Print planned changes without modifying the filesystem.
  --verify              Install, then verify the ownership manifest.
  --uninstall           Remove only unchanged entries listed in the ownership manifest.
  --no-extensions       Skip npm extensions and the vendored packages (pi-task,
                        pi-grok-style-tools, pi-workflows).
  --no-lean-ctx         Skip LeanCTX binary install and pi-lean-ctx routing.
  --with-agentmemory    Install/connect agentmemory for pi.
  --help                Show this help.

Installs:
  • skills/     → ~/.pi/agent/skills/paradox-* (real dir + content symlinks)
  • agents/     → ~/.pi/agent/agents/*.md
  • rules/      → playbook.md concatenated into ~/.pi/agent/APPEND_SYSTEM.md
  • templates/  → ~/.pi/templates
  • pi extras   → npm extensions + packages/pi-task, packages/pi-grok-style-tools,
                  packages/pi-workflows, LeanCTX, themes/settings
  • agentmemory → optional via --with-agentmemory
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --global)
      [[ -z "$SCOPE" ]] || die "choose exactly one install scope"
      SCOPE="global"
      shift
      ;;
    --project-local)
      [[ -z "$SCOPE" ]] || die "choose exactly one install scope"
      SCOPE="project"
      shift
      ;;
    --project-dir)
      (($# >= 2)) || die "--project-dir requires a value"
      PROJECT_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --verify)
      VERIFY=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --no-extensions)
      SKIP_EXTENSIONS=1
      shift
      ;;
    --no-lean-ctx)
      SKIP_LEAN_CTX=1
      shift
      ;;
    --with-agentmemory)
      WITH_AGENTMEMORY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ "$SCOPE" == "global" || "$SCOPE" == "project" ]] || die "choose --global or --project-local"
((DRY_RUN == 0 || VERIFY == 0)) || die "--dry-run and --verify cannot be combined"

ADAPTER="$ROOT_DIR/adapters/pi/adapter.yaml"
MANIFEST_TOOL="$ROOT_DIR/scripts/install_manifest.py"
[[ -f "$ADAPTER" ]] || die "missing runtime adapter: $ADAPTER"

adapter_value() {
  python3 "$MANIFEST_TOOL" adapter-value "$ADAPTER" "$1"
}

NAMESPACE="$(adapter_value install.namespace)"
MANIFEST_NAME="$(adapter_value install.manifest_name)"
RULES_DIR="$ROOT_DIR/rules"

if [[ "$SCOPE" == "global" ]]; then
  RELATIVE_HOME="$(adapter_value install.global_runtime_home)"
  RUNTIME_HOME="$HOME/$RELATIVE_HOME"
  RELATIVE_SKILLS="$(adapter_value install.global_skills_root)"
  SKILLS_ROOT="$HOME/$RELATIVE_SKILLS"
  RELATIVE_TEMPLATES="$(adapter_value install.global_templates_root)"
  TEMPLATES_ROOT="$HOME/$RELATIVE_TEMPLATES"
  RELATIVE_AGENTS="$(adapter_value install.global_agents_root)"
else
  RELATIVE_HOME="$(adapter_value install.project_runtime_home)"
  RUNTIME_HOME="$(CDPATH= cd -- "$PROJECT_DIR" && pwd -P)/$RELATIVE_HOME"
  RELATIVE_SKILLS="$(adapter_value install.project_skills_root)"
  SKILLS_ROOT="$(CDPATH= cd -- "$PROJECT_DIR" && pwd -P)/$RELATIVE_SKILLS"
  RELATIVE_TEMPLATES="$(adapter_value install.project_templates_root)"
  TEMPLATES_ROOT="$(CDPATH= cd -- "$PROJECT_DIR" && pwd -P)/$RELATIVE_TEMPLATES"
  RELATIVE_AGENTS="$(adapter_value install.project_agents_root)"
fi

AGENTS_ROOT=""
if [[ -n "${RELATIVE_AGENTS:-}" && "$RELATIVE_AGENTS" != "null" ]]; then
  if [[ "$SCOPE" == "global" ]]; then
    AGENTS_ROOT="$HOME/$RELATIVE_AGENTS"
  else
    AGENTS_ROOT="$(CDPATH= cd -- "$PROJECT_DIR" && pwd -P)/$RELATIVE_AGENTS"
  fi
fi

MANIFEST="$RUNTIME_HOME/$MANIFEST_NAME"

skill_files=()
while IFS= read -r skill_file; do
  [[ -n "$skill_file" ]] && skill_files+=("$skill_file")
done < <(python3 - "$ROOT_DIR" <<'PY'
import glob
import sys
from pathlib import Path

for path in sorted(glob.glob(f"{sys.argv[1]}/skills/*/SKILL.md"), key=lambda item: Path(item).parent.name):
    print(path)
PY
)
((${#skill_files[@]} > 0)) || die "no canonical skills discovered"

agent_files=()
while IFS= read -r agent_file; do
  [[ -n "$agent_file" ]] && agent_files+=("$agent_file")
done < <(python3 - "$ROOT_DIR" <<'PY'
import glob
import sys
from pathlib import Path
for path in sorted(glob.glob(f"{sys.argv[1]}/agents/*.md")):
    if Path(path).name == "README.md":
        continue
    print(path)
PY
)

printf 'Plan: %s paradox for pi (%s)\n' "$([[ $UNINSTALL == 1 ]] && printf uninstall || printf install)" "$SCOPE"
printf 'Runtime home: %s\n' "$RUNTIME_HOME"
printf 'Skills: %s\n' "$SKILLS_ROOT"
printf 'Templates: %s\n' "$TEMPLATES_ROOT"
[[ -n "$AGENTS_ROOT" ]] && printf 'Agents: %s\n' "$AGENTS_ROOT"
printf 'Rules -> APPEND_SYSTEM.md (%s)\n' "${HOME:-$PROJECT_DIR}/.pi/agent/APPEND_SYSTEM.md"
printf 'Ownership manifest: %s\n' "$MANIFEST"

run_agentmemory_if_requested() {
  local mode="$1"
  ((WITH_AGENTMEMORY == 1)) || return 0
  "$ROOT_DIR/scripts/install_agentmemory.sh" "$mode" --runtime pi --scope "$SCOPE" \
    || echo "WARN: agentmemory $mode reported issues" >&2
}

PI_APPEND_BEGIN="<!-- BEGIN paradox managed prompt -->"
PI_APPEND_END="<!-- END paradox managed prompt -->"
PI_RULE_ORDER=("playbook.md")

build_pi_append_system() { # build_pi_append_system <file>
  local dst="$1" tmp
  if [[ -L "$dst" ]] || { [[ -e "$dst" ]] && [[ ! -f "$dst" ]]; }; then
    echo "  WARN: preserving unsupported APPEND_SYSTEM target at $dst" >&2
    return 0
  fi

  tmp="$(mktemp "${TMPDIR:-/tmp}/paradox-append-system.XXXXXX")"
  if [[ -f "$dst" ]]; then
    awk -v begin="$PI_APPEND_BEGIN" -v end="$PI_APPEND_END" '
      $0 == begin { managed = 1; next }
      $0 == end { managed = 0; next }
      !managed { print }
    ' "$dst" > "$tmp"
  else
    : > "$tmp"
  fi

  if ((UNINSTALL == 1)); then
    if [[ ! -f "$dst" ]] || cmp -s "$dst" "$tmp"; then
      rm "$tmp"
    elif grep -q '[^[:space:]]' "$tmp"; then
      mv "$tmp" "$dst"
      echo "  removed paradox prompt from $dst"
    else
      rm "$tmp" "$dst"
      echo "  removed $dst"
    fi
    return 0
  fi

  if [[ -s "$tmp" ]] && [[ -n "$(tail -c 1 "$tmp")" ]]; then
    printf '\n' >> "$tmp"
  fi
  {
    echo "$PI_APPEND_BEGIN"
    echo "# Source: $ROOT_DIR/rules/"
    for rule in "${PI_RULE_ORDER[@]}"; do
      local src="$RULES_DIR/$rule"
      if [[ ! -f "$src" ]]; then
        echo "  WARN: missing $src (skipping)" >&2
        continue
      fi
      cat "$src"
      echo ""
    done
    echo "$PI_APPEND_END"
  } >> "$tmp"
  mkdir -p "$(dirname "$dst")"
  mv "$tmp" "$dst"
  echo "  updated $dst from ${#PI_RULE_ORDER[@]} rule file(s)"
}

if ((UNINSTALL == 1)); then
  [[ -f "$MANIFEST" ]] || die "no owned installation manifest found at $MANIFEST"
  python3 "$MANIFEST_TOOL" validate "$MANIFEST"
  if ((DRY_RUN == 1)); then
    printf 'Dry run: owned entries would be checked and removed; no files changed.\n'
    exit 0
  fi
  python3 "$MANIFEST_TOOL" uninstall "$MANIFEST"
  if [[ "$SCOPE" == "global" ]] && ((SKIP_EXTENSIONS == 0)); then
    extras_args=(uninstall)
    ((SKIP_LEAN_CTX == 1)) && extras_args+=(--no-lean-ctx)
    "$ROOT_DIR/scripts/install_pi_extras.sh" "${extras_args[@]}" \
      || echo "WARN: pi extras uninstall reported issues" >&2
  fi
  if [[ "$SCOPE" == "global" ]]; then
    build_pi_append_system "${HOME}/.pi/agent/APPEND_SYSTEM.md"
  fi
  run_agentmemory_if_requested uninstall
  exit 0
fi

# ---- plan entries (skills as real dir + content symlinks; agents; templates) ----
manifest_args=()
planned_skill_dirs=()
UPDATE=0
OWNED_TARGETS_FILE=""

if [[ -e "$MANIFEST" || -L "$MANIFEST" ]]; then
  UPDATE=1
  OWNED_TARGETS_FILE="$(mktemp "${TMPDIR:-/tmp}/paradox-owned-targets.XXXXXX")"
  python3 "$MANIFEST_TOOL" owned-targets "$MANIFEST" > "$OWNED_TARGETS_FILE"
  printf 'Existing Paradox installation detected; refreshing owned entries only.\n'
fi

target_is_owned() {
  ((UPDATE == 1)) && grep -Fqx -- "$1" "$OWNED_TARGETS_FILE"
}

assert_target_available() {
  local target="$1"
  if [[ -e "$target" || -L "$target" ]]; then
    target_is_owned "$target" || die "refusing to replace unowned entry: $target"
  fi
}

link_skill_plan() {
  local src="$1" dst="$2" package="$3" child existing
  planned_skill_dirs+=("$dst")
  printf '  skill dir %s (contents -> %s)\n' "$dst" "$src"
  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ -L "$dst" ]]; then
      die "refusing to replace unowned entry: $dst"
    fi
    if [[ -d "$dst" ]]; then
      for existing in "$dst"/*; do
        [[ -e "$existing" || -L "$existing" ]] || continue
        assert_target_available "$existing"
      done
    else
      die "refusing to replace unowned entry: $dst"
    fi
  fi
  for child in "$src"/*; do
    [[ -e "$child" ]] || continue
    local name target
    name="$(basename -- "$child")"
    target="$dst/$name"
    printf '    link %s -> %s\n' "$target" "$child"
    assert_target_available "$target"
    manifest_args+=(--entry "$package|$child|$target")
  done
}

for skill_file in "${skill_files[@]}"; do
  skill_dir="$(dirname -- "$skill_file")"
  skill_name="$(basename -- "$skill_dir")"
  link_skill_plan "$skill_dir" "$SKILLS_ROOT/$NAMESPACE$skill_name" "$skill_name"
done

if [[ -n "$AGENTS_ROOT" ]]; then
  for agent_file in "${agent_files[@]}"; do
    agent_name="$(basename -- "$agent_file")"
    target="$AGENTS_ROOT/$agent_name"
    assert_target_available "$target"
    printf '  link agent %s -> %s\n' "$target" "$agent_file"
    manifest_args+=(--entry "agent:$agent_name|$agent_file|$target")
  done
fi

templates_target="$TEMPLATES_ROOT"
printf '  link templates %s -> %s\n' "$templates_target" "$ROOT_DIR/templates"
assert_target_available "$templates_target"
manifest_args+=(--entry "templates|$ROOT_DIR/templates|$templates_target")

if ((DRY_RUN == 1)); then
  printf 'Dry run: no files changed%s.\n' "$([[ $UPDATE == 1 ]] && printf ' (owned entries would be refreshed)' || true)"
  [[ -n "$OWNED_TARGETS_FILE" ]] && rm -f -- "$OWNED_TARGETS_FILE"
  if [[ "$SCOPE" == "global" && "$SKIP_EXTENSIONS" -eq 0 ]]; then
    printf 'Dry run would also install Pi extras (extensions / pi-task / lean-ctx / themes).\n'
  fi
  if ((WITH_AGENTMEMORY == 1)); then
    printf 'Dry run would also connect agentmemory.\n'
  fi
  exit 0
fi

if ((UPDATE == 1)); then
  python3 "$MANIFEST_TOOL" uninstall "$MANIFEST"
fi
[[ -n "$OWNED_TARGETS_FILE" ]] && rm -f -- "$OWNED_TARGETS_FILE"

mkdir -p "$RUNTIME_HOME" "$SKILLS_ROOT"
[[ -n "$AGENTS_ROOT" ]] && mkdir -p "$AGENTS_ROOT"
mkdir -p "$(dirname -- "$TEMPLATES_ROOT")"

created_targets=()
created_skill_dirs=()
cleanup_partial_install() {
  if [[ -f "$MANIFEST" ]]; then
    python3 "$MANIFEST_TOOL" uninstall "$MANIFEST" >/dev/null 2>&1 || true
  else
    for target in "${created_targets[@]}"; do
      [[ -L "$target" ]] && rm -- "$target"
    done
    for skill_dir in "${created_skill_dirs[@]}"; do
      [[ -d "$skill_dir" ]] && rmdir "$skill_dir" 2>/dev/null || true
    done
  fi
}
trap cleanup_partial_install EXIT

for skill_file in "${skill_files[@]}"; do
  skill_dir="$(dirname -- "$skill_file")"
  skill_name="$(basename -- "$skill_dir")"
  dst="$SKILLS_ROOT/$NAMESPACE$skill_name"
  if [[ -L "$dst" ]]; then
    rm -- "$dst"
  fi
  mkdir -p "$dst"
  created_skill_dirs+=("$dst")
  for child in "$skill_dir"/*; do
    [[ -e "$child" ]] || continue
    target="$dst/$(basename -- "$child")"
    ln -s "$child" "$target"
    created_targets+=("$target")
  done
done

if [[ -n "$AGENTS_ROOT" ]]; then
  for agent_file in "${agent_files[@]}"; do
    target="$AGENTS_ROOT/$(basename -- "$agent_file")"
    ln -s "$agent_file" "$target"
    created_targets+=("$target")
  done
fi

ln -s "$ROOT_DIR/templates" "$TEMPLATES_ROOT"
created_targets+=("$TEMPLATES_ROOT")

python3 "$MANIFEST_TOOL" write "$MANIFEST" \
  --runtime pi \
  --scope "$SCOPE" \
  --repository-root "$ROOT_DIR" \
  --destination-root "$RUNTIME_HOME" \
  "${manifest_args[@]}"

if [[ "$SCOPE" == "global" ]]; then
  build_pi_append_system "${HOME}/.pi/agent/APPEND_SYSTEM.md"
fi

if [[ "$SCOPE" == "global" ]] && ((SKIP_EXTENSIONS == 0)); then
  extras_args=(install)
  ((SKIP_LEAN_CTX == 1)) && extras_args+=(--no-lean-ctx)
  "$ROOT_DIR/scripts/install_pi_extras.sh" "${extras_args[@]}" \
    || echo "WARN: pi extras install reported issues" >&2
fi

run_agentmemory_if_requested install

if ((VERIFY == 1)); then
  python3 "$MANIFEST_TOOL" validate "$MANIFEST" --check-files
  printf 'Verified paradox installation for pi (%d skills' "${#skill_files[@]}"
  if [[ -n "$AGENTS_ROOT" ]]; then
    printf ', %d agents' "${#agent_files[@]}"
  fi
  printf ', templates).\n'
fi

trap - EXIT
