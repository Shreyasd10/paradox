#!/usr/bin/env bash
# One-command installer for Paradox (no manual git clone).
#
# Interactive:
#   curl -fsSL https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.sh | bash
#
# Non-interactive:
#   curl -fsSL ... | bash -s -- --yes
#
# Local checkout (skips download):
#   ./get-paradox.sh
#
# Env overrides:
#   PARADOX_REPO=owner/name   PARADOX_REF=main|tag
#   PARADOX_HOME=~/.local/share/paradox
#   PARADOX_SOURCE_DIR=/path  (use an existing unpacked tree; skip fetch)
#   GITHUB_TOKEN / GH_TOKEN  (private repos)
set -euo pipefail

REPO="${PARADOX_REPO:-Shreyasd10/paradox}"
REF="${PARADOX_REF:-main}"
PARADOX_HOME="${PARADOX_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/paradox}"
SOURCE_OVERRIDE="${PARADOX_SOURCE_DIR:-}"

YES=0
DRY_RUN=0
VERIFY=1
WITH_AGENTMEMORY=""
EXTENSIONS_MODE=""         # all|no-lean-ctx|none
SKIP_FETCH=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: get-paradox.sh [options]

Downloads Paradox into a managed directory (no manual clone), then installs
via an interactive wizard — or non-interactively with --yes.

Options:
  --yes                     Non-interactive; use flags / defaults (no prompts)
  --with-agentmemory        Connect agentmemory for pi
  --no-agentmemory          Skip agentmemory (default)
  --no-extensions           Skip pi npm extensions / vendored packages
  --no-lean-ctx             Install extensions but skip LeanCTX
  --dry-run                 Plan only; do not modify the filesystem
  --no-verify               Skip post-install verify
  --skip-fetch              Do not download; use local tree / PARADOX_SOURCE_DIR
  --repo owner/name         GitHub repo (default: Shreyasd10/paradox)
  --ref REF                 Branch or tag (default: main)
  --help                    Show this help
EOF
}

while (($#)); do
  case "$1" in
    --yes) YES=1; shift ;;
    --with-agentmemory) WITH_AGENTMEMORY=1; shift ;;
    --no-agentmemory) WITH_AGENTMEMORY=0; shift ;;
    --no-extensions) EXTENSIONS_MODE="none"; shift ;;
    --no-lean-ctx) EXTENSIONS_MODE="no-lean-ctx"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-verify) VERIFY=0; shift ;;
    --skip-fetch) SKIP_FETCH=1; shift ;;
    --repo)
      (($# >= 2)) || die "--repo requires owner/name"
      REPO="$2"
      shift 2
      ;;
    --ref)
      (($# >= 2)) || die "--ref requires a branch or tag"
      REF="$2"
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

case "${EXTENSIONS_MODE}" in
  ""|all|no-lean-ctx|none) ;;
  *) die "extras mode must be all, no-lean-ctx, or none" ;;
esac

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

need_cmd bash
need_cmd curl
need_cmd tar
need_cmd python3
need_cmd mkdir
need_cmd mktemp

# Resolve script directory when executed from a file (not curl|bash).
SCRIPT_FILE=""
if [[ "${BASH_SOURCE[0]:-}" != *"bash"* && -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_FILE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/$(basename -- "${BASH_SOURCE[0]}")"
fi
LOCAL_ROOT=""
if [[ -n "$SCRIPT_FILE" && -f "$(dirname -- "$SCRIPT_FILE")/install.sh" ]]; then
  LOCAL_ROOT="$(CDPATH= cd -- "$(dirname -- "$SCRIPT_FILE")" && pwd -P)"
fi

prompt() {
  local question="$1" default="${2:-}" reply=""
  if ((YES == 1)); then
    printf '%s\n' "$default"
    return 0
  fi
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    die "no TTY for interactive prompts; re-run with --yes and explicit flags"
  fi
  if [[ -n "$default" ]]; then
    printf '%s [%s]: ' "$question" "$default" >/dev/tty
  else
    printf '%s: ' "$question" >/dev/tty
  fi
  IFS= read -r reply </dev/tty || true
  if [[ -z "$reply" ]]; then
    printf '%s\n' "$default"
  else
    printf '%s\n' "$reply"
  fi
}

github_curl() {
  local url="$1" out="$2"
  local -a args=(-fsSL)
  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}" -H "X-GitHub-Api-Version: 2022-11-28")
  fi
  curl "${args[@]}" "$url" -o "$out"
}

# GitHub archives omit submodule content; fetch each submodule's default
# branch archive and unpack it at its path so install_pi_extras.sh finds the
# real package. Git clones pin the exact commit via `git submodule` instead.
fetch_submodules() {
  local dest="$1"
  [[ -f "$dest/.gitmodules" ]] || return 0
  local modules_file="$dest/.gitmodules" sub_path sub_url
  while IFS='|' read -r sub_path sub_url; do
    [[ -n "$sub_path" && -n "$sub_url" ]] || continue
    local repo="${sub_url#https://github.com/}"
    repo="${repo%.git}"
    local sub_tmp sub_archive branch sub_extract sub_root
    sub_tmp="$(mktemp -d "${TMPDIR:-/tmp}/paradox-submodule.XXXXXX")"
    sub_archive="$sub_tmp/sub.tgz"
    local fetched=0
    for branch in main master; do
      if github_curl "https://github.com/$repo/archive/refs/heads/$branch.tar.gz" "$sub_archive" 2>/dev/null; then
        fetched=1
        break
      fi
    done
    if ((fetched != 1)); then
      echo "  WARN: could not fetch submodule $sub_path" >&2
      rm -rf "$sub_tmp"
      continue
    fi
    sub_extract="$sub_tmp/extract"
    mkdir -p "$sub_extract"
    tar -xzf "$sub_archive" -C "$sub_extract"
    sub_root="$(find "$sub_extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    if [[ -n "$sub_root" ]]; then
      mkdir -p "$dest/$sub_path"
      cp -a "$sub_root/." "$dest/$sub_path/"
      echo "  submodule $sub_path ($repo@$branch)"
    else
      echo "  WARN: submodule $sub_path archive empty" >&2
    fi
    rm -rf "$sub_tmp"
  done < <(awk -F' = ' '/^[[:space:]]*path[[:space:]]*=/{p=$2} /^[[:space:]]*url[[:space:]]*=/{print p "|" $2}' "$modules_file")
}

fetch_package() {
  local dest="$1"
  local tmp archive extracted url_branch url_tag
  need_cmd curl
  need_cmd tar
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/paradox-fetch.XXXXXX")"
  archive="$tmp/src.tgz"
  url_branch="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
  url_tag="https://github.com/${REPO}/archive/refs/tags/${REF}.tar.gz"

  printf 'Downloading %s@%s ...\n' "$REPO" "$REF"
  if ! github_curl "$url_branch" "$archive" 2>/dev/null; then
    github_curl "$url_tag" "$archive" \
      || die "failed to download ${REPO}@${REF} (set GITHUB_TOKEN for private repos)"
  fi

  mkdir -p "$tmp/extract"
  tar -xzf "$archive" -C "$tmp/extract"
  extracted="$(find "$tmp/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [[ -n "$extracted" && -f "$extracted/install.sh" ]] \
    || die "downloaded archive missing install.sh"

  rm -rf "$dest"
  mkdir -p "$(dirname -- "$dest")"
  mv -- "$extracted" "$dest"
  rm -rf "$tmp"
  fetch_submodules "$dest"
  printf 'Package ready at %s\n' "$dest"
}

resolve_root() {
  if [[ -n "$SOURCE_OVERRIDE" ]]; then
    [[ -f "$SOURCE_OVERRIDE/install.sh" ]] || die "PARADOX_SOURCE_DIR missing install.sh: $SOURCE_OVERRIDE"
    printf '%s\n' "$(CDPATH= cd -- "$SOURCE_OVERRIDE" && pwd -P)"
    return 0
  fi
  if ((SKIP_FETCH == 1)); then
    if [[ -n "$LOCAL_ROOT" ]]; then
      printf '%s\n' "$LOCAL_ROOT"
      return 0
    fi
    [[ -f "$PARADOX_HOME/current/install.sh" ]] || die "--skip-fetch but no package at $PARADOX_HOME/current"
    printf '%s\n' "$PARADOX_HOME/current"
    return 0
  fi
  if [[ -n "$LOCAL_ROOT" && "$YES" -eq 0 ]]; then
    printf '%s\n' "$LOCAL_ROOT"
    return 0
  fi
  if [[ -n "$LOCAL_ROOT" && "$YES" -eq 1 && -z "${PARADOX_FORCE_FETCH:-}" ]]; then
    printf '%s\n' "$LOCAL_ROOT"
    return 0
  fi
  fetch_package "$PARADOX_HOME/current"
  printf '%s\n' "$PARADOX_HOME/current"
}

run_wizard() {
  if [[ -z "$EXTENSIONS_MODE" ]]; then
    printf '\nPi extras (extensions, pi-task, pi-grok-style-tools, pi-workflows, LeanCTX, themes):\n'
    printf '  1) Install all recommended\n'
    printf '  2) Install extras but skip LeanCTX\n'
    printf '  3) Skip all Pi extras\n'
    case "$(prompt "Choose extras" "1")" in
      2|no-lean*) EXTENSIONS_MODE="no-lean-ctx" ;;
      3|none|skip) EXTENSIONS_MODE="none" ;;
      *) EXTENSIONS_MODE="all" ;;
    esac
  fi

  if [[ -z "$WITH_AGENTMEMORY" ]]; then
    case "$(prompt "Connect agentmemory for pi? (y/N)" "n")" in
      y|Y|yes|YES) WITH_AGENTMEMORY=1 ;;
      *) WITH_AGENTMEMORY=0 ;;
    esac
  fi
}

apply_defaults() {
  EXTENSIONS_MODE="${EXTENSIONS_MODE:-all}"
  WITH_AGENTMEMORY="${WITH_AGENTMEMORY:-0}"
}

build_install_args() {
  local -a args=(--global)
  if ((DRY_RUN == 1)); then
    args+=(--dry-run)
  elif ((VERIFY == 1)); then
    args+=(--verify)
  fi
  case "$EXTENSIONS_MODE" in
    none) args+=(--no-extensions) ;;
    no-lean-ctx) args+=(--no-lean-ctx) ;;
  esac
  ((WITH_AGENTMEMORY == 1)) && args+=(--with-agentmemory)
  printf '%s\n' "${args[@]}"
}

confirm_and_run() {
  local root="$1"

  printf '\n── Plan ─────────────────────────────────────────\n'
  printf 'Package:   %s\n' "$root"
  printf 'Runtime:   pi\n'
  printf 'Extras:    %s\n' "$EXTENSIONS_MODE"
  printf 'agentmemory: %s\n' "$([[ "$WITH_AGENTMEMORY" == "1" ]] && echo yes || echo no)"
  printf 'Dry run:   %s\n' "$([[ "$DRY_RUN" == "1" ]] && echo yes || echo no)"
  printf '────────────────────────────────────────────────\n'

  if ((YES == 0)); then
    case "$(prompt "Proceed?" "Y")" in
      n|N|no|NO) printf 'Aborted.\n'; exit 0 ;;
    esac
  fi

  printf '\n>>> Installing for pi\n'
  local -a args=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] && args+=("$line")
  done < <(build_install_args)
  (CDPATH= cd -- "$root" && bash ./install.sh "${args[@]}")

  printf '\nDone.\n'
  printf 'Managed package: %s\n' "$root"
  printf 'Re-run this command on another machine the same way; no manual clone needed.\n'
}

main() {
  printf 'Paradox installer\n'

  if ((YES == 1)); then
    apply_defaults
  else
    run_wizard
    apply_defaults
  fi

  local root
  root="$(resolve_root)"
  [[ -x "$root/install.sh" || -f "$root/install.sh" ]] || die "install.sh missing in $root"
  confirm_and_run "$root"
}

main
