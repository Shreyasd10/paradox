# @shreyasdevadiga/pi-task

A [pi](https://pi.dev) extension that adds a single **`task`** tool for isolated subagent sessions: foreground/background, resume, cancellation, and a **Grok Build–style** TUI (flat tasks-pane widget, FleetView, conversation viewer, `/tasks`).

Replaces the older `pi-subagents` `subagent` tool.

## Install

### From local path (development)

```bash
pi install /absolute/path/to/pi-task
# or
pi install ./pi-task
```

### From git (any machine)

```bash
pi install git:github.com/Shreyasd10/pi-task
# pinned:
pi install git:github.com/Shreyasd10/pi-task@v0.1.1
# SSH:
pi install git:git@github.com:Shreyasd10/pi-task
```

### From npm (after publish)

```bash
pi install npm:@shreyasdevadiga/pi-task
# pinned:
pi install npm:@shreyasdevadiga/pi-task@0.1.1
```

Project-local install (shared with teammates via `.pi/settings.json`):

```bash
pi install -l npm:@shreyasdevadiga/pi-task
```

One-shot trial without permanent install:

```bash
pi -e /path/to/pi-task
# or
pi -e git:github.com/Shreyasd10/pi-task
```

Verify:

```bash
pi list
# then in an interactive session: /reload  and confirm `task` tool + /tasks
```

To migrate off `pi-subagents`, remove it from packages after installing pi-task (or use my-workflow's `scripts/install-pi-task.sh --replace`).

## Uninstall

```bash
pi remove npm:@shreyasdevadiga/pi-task
# or whatever source you installed:
pi remove git:github.com/Shreyasd10/pi-task
pi remove /absolute/path/to/pi-task
```

## Requirements

- [pi](https://pi.dev) / `@earendil-works/pi-coding-agent` **≥ 0.80.0**
- Node **≥ 20**

Pi provides peer packages (`pi-coding-agent`, `pi-tui`, `pi-ai`, `typebox`) at runtime. This package has no extra runtime dependencies.

## Quick start

In Pi, the parent agent (or you) calls:

```
task({
  agent: "codebase-locator",
  task: "Find all files that handle authentication",
  background: true,
})
```

| Mode | Behavior |
|------|----------|
| **Foreground** (default) | Blocks until the child finishes; result returns inline |
| **Background** | Returns a `task_id` immediately; completion arrives as a styled follow-up notification |
| **Resume** | `task({ task_id: "...", task: "follow-up prompt" })` continues the same child session |

### Tool parameters

| Param | Required | Notes |
|-------|----------|--------|
| `agent` | yes | Agent name from the discovered set |
| `task` | yes | Prompt for the child |
| `cwd` | no | Working directory (defaults to parent cwd) |
| `task_id` | no | Resume a prior task |
| `background` | no | Run async (`true`) |
| `context` | no | `"fresh"` (default) or `"fork"` (branch + sanitize parent session) |
| `agent_scope` | no | `"user"` (default), `"project"`, or `"both"` |
| `child_extensions` | no | `["advisor"]` opts a new child into the installed upstream Advisor extension; retained for background/resume |
| `max_turns` | no | Cap completed turns (`0` disables; default from config) |
| `max_output_tokens` | no | Cap total child output tokens (`0` disables; default from config) |
| `thinking` | no | `inherit` / `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` |

Agents are discovered from `~/.pi/agent/agents/*.md` by default. Use `agent_scope: "project"` or `"both"` for `.pi/agents` (project-local agents prompt for confirmation). Agent Markdown / prompt text is **not** modified by pi-task runtime policy.

### UI

| Surface | What it does |
|---------|----------------|
| Above-editor **widget** | Grok flat rows + `[↗]`/`[✗]`; **Ctrl+T** focus · enter open · x stop |
| **FleetView** | Below-editor list; `↓`/`←` at empty prompt, Enter open, **x** stop |
| **Conversation viewer** | Scroll child `session.jsonl`; `x` twice to stop; steer deferred |
| **`/tasks`** | List, view, stop, settings |

## Runtime policy (`~/.pi/agent/pi-task.json`)

Optional global config (missing file → built-in defaults, no warning):

```json
{
  "maxConcurrent": 5,
  "maxQueued": 8,
  "providerConcurrency": {},
  "defaultThinking": "inherit",
  "defaultMaxTurns": 12,
  "defaultMaxOutputTokens": 32768,
  "maxOutputTokensPerRequest": 16384,
  "resultHeadBytes": 16384,
  "resultTailBytes": 8192
}
```

- **Concurrency:** up to `maxConcurrent` children run at once (default **5**); up to `maxQueued` wait. Provider-specific caps via `providerConcurrency` (e.g. `{ "openai": 2 }`); `0` disables that provider cap.
- **Background ack:** `background: true` returns a task ID immediately while queued/running; admission is lease-based and cancellable.
- **Thinking:** defaults to inherit the parent level; fork safety can still force `off`.
- **Budgets:** turn/output caps stop further provider calls and leave a resume hint; `0` disables that cap. Full child transcript stays in the task session.
- **Parent-visible output:** retained as a UTF-8-safe **16KB head + 8KB tail** (24KB total) when larger; omitted-byte marker points at the child session path.
- **Shared runtime:** children share one lazy Pi `ModelRuntime`. Default children keep the reload-free isolated loader; Advisor opt-in children reload only its allowlisted manifest (prompt bytes stay unchanged).

Malformed JSON → defaults + one warning notification; tasks still launch.

## Publish (npm)

```bash
cd pi-task
npm login
npm publish --access public
```

Then on any machine:

```bash
pi install npm:@shreyasdevadiga/pi-task
```

## Git release flow

```bash
git add .
git commit -m "feat: pi-task v0.1.1"
git tag v0.1.1
git push origin main --tags
```

Others install with:

```bash
pi install git:github.com/Shreyasd10/pi-task@v0.1.1
```

## Development

```bash
# typecheck
npm run typecheck

# unit tests (peer packages resolved via global pi install)
npm test

# load without installing
pi -e ./src/index.ts
```

Symlink peer deps for local tests if needed:

```bash
mkdir -p node_modules/@earendil-works
PI_PKG="$(npm root -g)/@earendil-works/pi-coding-agent"
ln -sf "$PI_PKG" node_modules/@earendil-works/pi-coding-agent
ln -sf "$PI_PKG/node_modules/@earendil-works/pi-agent-core" node_modules/@earendil-works/pi-agent-core
ln -sf "$PI_PKG/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
ln -sf "$PI_PKG/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
ln -sf "$PI_PKG/node_modules/typebox" node_modules/typebox
```

A development mirror also lives under `my-workflow/extensions/pi-task/` (same modules; keep in sync with `src/`).

## Design notes

- Children run as **native in-process `AgentSession`s** (`createAgentSession`), not separate `pi --mode json` OS processes. That preserves model resolution, provider retries, typed events, and final error metadata.
- Extensions and skills are off by default. `child_extensions: ["advisor"]` resolves only the installed upstream Advisor manifest while normal extensions, skills, prompts, themes, and context files stay disabled. A short **lean-ctx CLI preference** preamble is prepended to every child system prompt so LeanCTX-equipped environments still prefer compressed tools via the `lean-ctx` binary (MCP `ctx_*` tools are not loaded).
- Task state: `~/.pi/agent/task-state/<id>/` (`record.json`, `result.json`).
- Child sessions: under `~/.pi/agent/sessions/.../<task-id>/session.jsonl`.
- Background completions are **parent-session isolated**: the result watcher only delivers when `record.parentId` matches the current session id (cross-session bleed is retained on disk for the originating session to reconcile).
- Mid-run **steer** is deferred (needs a control channel); **stop** works via AbortController / SIGTERM path.
- Tool results use `AgentToolResult` (`content` + `details`); soft errors return text in `content` with `details: {}` rather than the old `isError` field.

## License

MIT

