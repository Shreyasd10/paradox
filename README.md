# Paradox

**pi with batteries.** An installable pi distribution that bundles a delivery
workflow (skills + agents), an always-on behavior playbook (rules), themes,
and a curated extension stack — for macOS and Windows.

Inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi): where omp forks
pi's core and bakes the tooling in, Paradox layers batteries **on top of stock
pi** — skills, agent definitions, a rules addendum, themes, and extensions —
installed and uninstalled cleanly through an ownership manifest.

## Install

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.ps1 | iex
```

Requires [pi](https://github.com/earendil-works/pi-mono) itself:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent   # or: bun install -g @earendil-works/pi-coding-agent
```

The one-liner downloads the package into `~/.local/share/paradox/current`
(no manual clone), then walks through extras / agentmemory prompts — or runs
non-interactively with `--yes` (macOS) or flags (Windows).

`packages/pi-workflows` is a git submodule of
[github.com/Shreyasd10/pi-workflows](https://github.com/Shreyasd10/pi-workflows)
(no drift — one source of truth). Git clones get the pinned commit with
`git clone --recursive` (or `git submodule update --init`). The one-liner
downloaders fetch its current `main` archive automatically, since GitHub
archives omit submodule content.

## Update

Re-run the same install command. If Paradox is already installed, the installer
automatically performs an incremental update: it refreshes manifest-owned
skills, agents, templates, rules, and extension packages while refusing to
replace unrelated entries. Existing user settings are merged rather than
deleted.

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.sh | bash
```

```powershell
# Windows
irm https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.ps1 | iex
```

## What's inside

| Layer | Content | Installed to |
|---|---|---|
| Skills | 20 workflow skills (`paradox-*` namespace) | `~/.pi/agent/skills/paradox-*` |
| Agents | 8 agent definitions (codebase, implementer, research, …) | `~/.pi/agent/agents/*.md` |
| Rules | `rules/playbook.md` → always-on system prompt addendum | `~/.pi/agent/APPEND_SYSTEM.md` |
| Templates | artifact templates | `~/.pi/templates` |
| Themes | grok-dark, claude-dark | `~/.pi/agent/themes` |
| Settings | theme/provider/subagent defaults (merge, never clobber) | `~/.pi/agent/settings.json` |
| Permissions | hand-tuned pi-permission-system rules (paths, bash ask-list, MCP) | `~/.pi/agent/extensions/pi-permission-system/config.json` |
| Extension configs | subagent tool-description mode, agentmemory extension | `~/.pi/agent/extensions/{subagent,agentmemory}` |
| Extensions | 8 npm extensions + 3 vendored packages | via `pi install` |
| LeanCTX | binary + pi routing config (`managedBy: paradox`) + env defaults | `~/.pi/agent/extensions/pi-lean-ctx` |
| LeanCTX user config | shell allowlist + allowed paths (installed if absent) | `~/.config/lean-ctx/config.toml` |

### Vendored packages (monorepo)

The local extension repos live in this monorepo under `packages/` and install
via `pi install <path>` — no GitHub clone at install time:

- `packages/pi-task` — subagent framework (task tool with isolated child sessions)
- `packages/pi-grok-style-tools` — Grok Build–style TUI chrome
- `packages/pi-workflows` — DAG-driven resumable workflow extension + builtin workflows

npm extensions installed by default: `pi-permission-system`, `rpiv-todo`,
`rpiv-ask-user-question`, `pi-x-ide`, `pi-lean-ctx`, `pi-usage`,
`supi-context`, `rpiv-advisor`.

## Repo layout

```
paradox/
├── install.sh            # macOS/Linux installer (manifest-based, safe)
├── install.ps1           # Windows installer (junctions + manifest)
├── get-paradox.sh        # macOS one-liner (curl | bash)
├── get-paradox.ps1       # Windows one-liner (irm | iex)
├── skills/               # canonical skills (paradox-* namespace)
├── agents/               # agent definitions
├── rules/                # playbook.md → APPEND_SYSTEM.md
├── templates/            # artifact templates
├── pi-config/            # settings.partial.json, themes/, extension configs,
│                         # lean-ctx config (env defaults + user config template)
├── packages/             # vendored extension packages (pi-task, pi-grok-style-tools,
│                         # pi-workflows, agentmemory extension)
├── adapters/pi/          # install adapter (namespace, roots, manifest)
└── scripts/              # manifest tool, extras, agentmemory helpers
```

## Uninstall

```sh
# macOS
./install.sh --global --uninstall

# Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

Removes only unchanged entries listed in the ownership manifest
(`~/.pi/.paradox-install-manifest.json`); foreign files are never touched.
Pi extras roll back owned extension packages; themes/settings and the
LeanCTX binary are left in place.

## Verify

```sh
./install.sh --global --verify
python3 scripts/install_manifest.py validate ~/.pi/.paradox-install-manifest.json --check-files
```

Full install docs: [docs/install.md](docs/install.md)
