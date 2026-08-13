# @shreyasdevadiga/pi-grok-style-tools

A [pi](https://pi.dev) extension that ports [Grok Build](https://github.com/xai-org) TUI look-and-feel into pi: Oscura Midnight / GrokNight palettes, braille spinner, ◆ verb-first tool rows, thinking chrome, rounded prompt box with elevated fill, grey user-message bands, pulsed accent rails, and OSC tab-title spinner.

Visual source of truth: grok-build (`xai-grok-pager` / `xai-grok-pager-render`). Extension scaffold patterns inspired by pi-claude-style-tools (API only — not Claude glyphs/verbs).

## Install

```bash
pi install /absolute/path/to/pi-grok-style-tools
```

Copy a theme (or symlink):

```bash
cp theme/oscura-midnight.json theme/grok-dark.json ~/.pi/agent/themes/
```

In `~/.pi/agent/settings.json`:

```json
{
  "theme": "oscura-midnight",
  "packages": [
    "../../Desktop/workspace/pi-grok-style-tools"
  ]
}
```

Do **not** load alongside `pi-claude-style-tools` (both patch `Loader.prototype`).

Then `/reload` in an interactive session.

### Atomic

Atomic isolates extensions in an RPC child by default, which prevents UI prototype patches and custom editor components from reaching the parent TUI. Apply the managed compatibility patch to run Atomic's interactive engine in-process:

```bash
npm run atomic:patch
npm run atomic:check
```

What `atomic:patch` does:

1. Patches installed `dist/main.js` / `dist/cli.js` so `ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION=1` disables isolation (supports both `engineEnv.child` Atomic ≥0.9.12 and older env-flag builds).
2. Writes durable `"interactiveEngineIsolation": false` into `~/.atomic/agent/settings.json` without clobbering theme/packages/other keys (refuses malformed/conflicting values).
3. Links `grok-dark.json` into `~/.atomic/agent/themes/`.

`atomic:patch` also installs a wrapper at `~/.atomic/bin/atomic` (and prepends that dir to PATH in your shell rc). After `atomic update` / `atomic update --all` / `atomic update self`, the wrapper re-runs the patch automatically. Extension-only or `--models` updates are left alone.

Open a new shell once so `which atomic` shows `~/.atomic/bin/atomic`. Override the package location with `PI_GROK_STYLE_TOOLS` if you move this repo.

Temporarily restore isolation with `ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION=0 atomic`, or remove the patch + wrapper with `npm run atomic:rollback`.

Configure the package and `"theme": "grok-dark"` in `~/.atomic/agent/settings.json`.

### OMP (Oh My Pi)

Configure the package and theme in `~/.omp/agent/config.yml`:

```yaml
extensions:
  - /absolute/path/to/pi-grok-style-tools   # directory entry: resolves pi.extensions (index.ts, spinner.ts, chrome.ts)
theme:
  dark: grok-dark
```

Copy the theme into omp's custom themes dir:

```bash
mkdir -p ~/.omp/agent/themes
cp theme/grok-dark.json ~/.omp/agent/themes/grok-dark.json
```

omp validates custom themes strictly and requires color tokens beyond pi's. The stock `grok-dark.json` is missing them, so add to `colors` in `~/.omp/agent/themes/grok-dark.json`:

```json
"pythonMode": "grokYellow",
"statusLineBg": "bgPanel",
"statusLineSep": "borderDark",
"statusLineModel": "grokBlue",
"statusLinePath": "grokCyan",
"statusLineGitClean": "grokGreen",
"statusLineGitDirty": "grokYellow",
"statusLineContext": "gray",
"statusLineSpend": "brightGray",
"statusLineStaged": "grokGreen1",
"statusLineDirty": "grokOrange",
"statusLineUntracked": "gray",
"statusLineOutput": "brightGray",
"statusLineCost": "grokPurple",
"statusLineSubagents": "grokMagenta"
```

OMP-specific behavior:

- The omp status line renders **below** the prompt box (not inside it), and the editor's `+-`/`-+` corner markers are stripped.
- `ctx.ui.setFooter` is a no-op in omp, so the Grok Build footer chrome does not render; the prompt box, tool rows, spinner, commands, and user-message chrome all work.
- Do **not** load alongside `pi-claude-style-tools` (both patch `Loader.prototype`).

Changes take effect on the next `omp` launch.

## What you get

- Oscura Midnight (`oscura-midnight`) and GrokNight (`grok-dark`) themes
- Braille loader + **turn-status** row: `Thinking… 0.5s … 1m49s ⇣12k · Ctrl+C`
- Footer chrome: `Grok Build` · `always-approve` (from permission-system yolo) · shortcuts bar
- Tool rows: `◆ Read path`, `◆ Run cmd`, `◈` group folds, `┃` accent rails (no ─── wrappers)
- Thinking: `Thinking…` / `Thought for Ns`
- Sent user messages: elevated grey band + `❯ ` (Grok scrollback, not a labeled box)
- Prompt editor: `╭─╮` box with `❯ ` and the same grey fill
- Pulsed accent on running tools/thinking
- Tab title: `⠋ Thinking - {cwd} - grok`

## Configuration

Useful settings in `.pi/settings.json`, `~/.pi/agent/settings.json`, `.atomic/settings.json`, or `~/.atomic/agent/settings.json` (same keys as the Claude-style slim fork where applicable):

```json
{
  "toolBackground": "transparent",
  "previewLines": 8,
  "groupToolCalls": true,
  "themeAdaptive": true,
  "liveToolPreview": true
}
```

## Development

```bash
cd pi-grok-style-tools
npm install
npm run typecheck
```

## License

MIT
