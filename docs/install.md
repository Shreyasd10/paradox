# Install Paradox

Paradox installs skills, agents, rules, templates, themes, settings, and the
extension stack (npm + vendored packages) for pi. Every installed entry is
recorded in an ownership manifest; uninstall touches only owned entries.

## One-command install (no clone)

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.sh | bash
```

The script downloads the package into `~/.local/share/paradox/current`
(no manual `git clone`), then asks:

1. **Pi extras** (extensions / vendored packages / LeanCTX / themes)
2. **agentmemory** yes/no

Non-interactive example:

```bash
curl -fsSL https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.sh | bash -s -- --yes
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.ps1 | iex
```

Flags (run the downloaded file for non-default options):

```powershell
powershell -ExecutionPolicy Bypass -File .\get-paradox.ps1 -NoExtensions -NoLeanCtx -WithAgentmemory
```

Private repo: export `GITHUB_TOKEN` (or `GH_TOKEN`) on macOS before running.
Override ref/repo with `PARADOX_REF` / `PARADOX_REPO` (or `--ref` / `--repo`
on macOS), and the managed home with `PARADOX_HOME`.

## Install from a local checkout

```bash
./get-paradox.sh                  # interactive wizard
./install.sh --global --verify    # direct flags

# Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Scope global -Verify
```

## Inspect before installing

```bash
./install.sh --global --dry-run
./get-paradox.sh --yes --dry-run
```

## What gets installed (global pi)

| Component | Source | Destination |
|---|---|---|
| Skills | `skills/*` | `~/.pi/agent/skills/paradox-*` (real dir + content symlinks) |
| Agents | `agents/*.md` | `~/.pi/agent/agents/*.md` |
| Rules | `rules/playbook.md` | `~/.pi/agent/APPEND_SYSTEM.md` (managed block) |
| Templates | `templates/` | `~/.pi/templates` |
| Themes | `pi-config/themes/*.json` | `~/.pi/agent/themes/*.json` |
| Settings | `pi-config/settings.partial.json` | merged into `~/.pi/agent/settings.json` |
| Permissions | `pi-config/extensions/pi-permission-system/config.json` | `~/.pi/agent/extensions/pi-permission-system/config.json` (if absent) |
| Subagent config | `pi-config/extensions/subagent/config.json` | `~/.pi/agent/extensions/subagent/config.json` (if absent) |
| agentmemory ext | `packages/agentmemory/` | `~/.pi/agent/extensions/agentmemory/` + settings entry |
| npm extensions | 8 packages | via `pi install npm:...` |
| Vendored packages | `packages/pi-task`, `packages/pi-grok-style-tools`, `packages/pi-workflows` | via `pi install <path>` (npm ci --omit=dev first) |
| LeanCTX | `lean-ctx-bin` + config with env defaults | `~/.pi/agent/extensions/pi-lean-ctx/config.json` (`managedBy: paradox`) |
| LeanCTX user config | `pi-config/lean-ctx/config.toml` | `~/.config/lean-ctx/config.toml` (if absent) |
| agentmemory | optional (`--with-agentmemory`) | CLI + `agentmemory connect pi --force` |

Ownership manifest: `~/.pi/.paradox-install-manifest.json`.

### Pi extras (global pi, on by default)

```bash
./install.sh --global --verify --no-extensions   # skip npm + vendored packages
./install.sh --global --verify --no-lean-ctx     # keep extensions; skip LeanCTX
```

### agentmemory (optional)

```bash
./install.sh --global --verify --with-agentmemory
```

## Project-local install

```bash
./install.sh --project-local --verify
./install.sh --project-local --project-dir /path/to/repository --verify
```

Project roots: `<project>/.pi/skills`, `<project>/.pi/agents`,
`<project>/.pi/templates`. Extras and rules are global-only.

## Uninstall

```bash
# macOS
./install.sh --global --uninstall

# Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

Uninstall removes only unchanged owned entries from the manifest (skills
content symlinks, agent symlinks/copies, templates link, generated
APPEND_SYSTEM.md block), then rolls back owned extension packages / the
pi-lean-ctx config. Themes, settings, and the LeanCTX binary are left in place.

## Verification

```bash
./install.sh --global --verify
python3 scripts/install_manifest.py validate ~/.pi/.paradox-install-manifest.json --check-files
```

## Requirements

- macOS (bash 3.2+, curl, tar, python3, node for settings merge) or Windows
  (PowerShell 5.1+, npm optional)
- [pi](https://github.com/earendil-works/pi-mono) installed
  (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent` or
  `bun install -g @earendil-works/pi-coding-agent`) for the extension step;
  skills/agents/rules/themes install even without it
