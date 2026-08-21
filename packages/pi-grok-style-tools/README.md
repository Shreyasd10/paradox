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

Atomic always uses a fullscreen alt-screen. A custom prompt **must** extend
`CustomEditor` from `@bastani/atomic` (not Pi's) and return
`super.handleInput(data)` so wheel / Page Up stay on the transcript. This
package does that automatically: it loads Atomic's host editor when `atomic`
is running, and only overrides `render()` for the Grok `╭─╮` box.

#### Wheel scroll and mouse reporting

The alt-screen enables SGR mouse reporting on entry, but that can be lost during
startup. When the terminal is not reporting mouse, the wheel arrives as bare
`↑`/`↓` keys; Atomic's `CustomEditor` runs those through prompt history and
returns `false`, so scrolling fills the prompt with past messages instead of
moving the transcript. On editor mount this package re-asserts the same mouse
modes pi-tui uses. Set `GROK_TOOLS_FORCE_MOUSE=0` to skip that.

Diagnostics and escape hatches:

| Variable | Effect |
| --- | --- |
| `GROK_TOOLS_DEBUG_INPUT=1` | Log editor input, host editor resolution, and mouse-mode writes to `/tmp/grok-input.log` (override with `GROK_TOOLS_DEBUG_LOG`) |
| `GROK_TOOLS_PROMPT_EDITOR=0` | Keep the Grok renderers but leave the host prompt untouched |
| `GROK_TOOLS_FORCE_MOUSE=0` | Do not re-assert mouse reporting |

Atomic isolates extensions in an RPC child by default, which prevents UI
prototype patches and custom editor components from reaching the parent TUI.
Apply the managed compatibility setup once:

```bash
npm run atomic:patch
npm run atomic:check
```

What `atomic:patch` does:

1. Installs a wrapper at `~/.atomic/bin/atomic` that disables isolation at runtime (`ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION=1` plus an ESM loader). `atomic update` does not need a re-patch.
2. Best-effort patches installed `dist/main.js` / `dist/cli.js` so a direct npm-global `atomic` also works until the next Atomic install. This is optional; the wrapper is the durable path.
3. Writes durable `"interactiveEngineIsolation": false` into `~/.atomic/agent/settings.json` without clobbering theme/packages/other keys (refuses malformed/conflicting values).
4. Links `grok-dark.json` and `oscura-midnight.json` into `~/.atomic/agent/themes/`, and excludes the same filenames under `~/.pi/agent/themes` so Atomic does not warn about inherited Pi copies.

Open a new shell once so `which atomic` shows `~/.atomic/bin/atomic`.

Temporarily restore isolation with `ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION=0 atomic`, or remove the setup with `npm run atomic:rollback`.

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

- The omp status line renders **below** the prompt box (not inside the editor top border). Current omp embeds status via `setTopBorderProvider`; this extension captures that provider, hides native editor chrome, and paints the chips under the Grok `╭─╮` box.
- The editor's `+-`/`-+` (and unicode corner) markers are stripped inside the box.
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
