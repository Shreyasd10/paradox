# @shreyasdevadiga/pi-workflows

Atomic's [workflows](https://github.com/bastani-inc/atomic/tree/main/packages/workflows)
packaged as an installable extension for **stock pi**: multi-stage, DAG-driven
workflow execution with tracked stages, durable resumable runs, human-in-the-loop
gates, parallel fan-out, and a graph orchestrator pane (`F2`).

This is the exact extension shipped inside `@bastani/atomic@0.9.12` (vendored
from its published tarball so the extension code and the SDK it links against
are always the same release), repackaged with `@bastani/atomic` as a regular
dependency so pi's extension loader can resolve it.

## Install

From git (any machine):

```bash
pi install git:github.com/Shreyasd10/pi-workflows
# pinned:
pi install git:github.com/Shreyasd10/pi-workflows@v0.1.0
```

From a local checkout:

```bash
pi install /path/to/pi-workflows
```

Project-local install (shared via `.pi/settings.json`):

```bash
pi install -l /path/to/pi-workflows
```

Then start pi and confirm:

```bash
pi list          # @shreyasdevadiga/pi-workflows present
# interactive: /reload, then F2 opens the workflow orchestrator, /workflow works
```

## What you get

- `/workflow` command + `workflow` tool + F2 orchestrator pane (graph overlay,
  stage chat, pause / resume / quit, post-mortem)
- Workflow authoring API: `workflow({...})` with `ctx.task`, `ctx.stage`,
  `ctx.chain`, `ctx.parallel`, `ctx.workflow` (nesting), `ctx.tool` (durable
  tool nodes), `ctx.ui.*` human-in-the-loop
- Builtin workflows: `fanOutAndSynthesize`, `adversarialVerification`,
  `tournament`, `classifyAndAct`, `generateAndFilter`, `goal`, `loopUntilDone`,
  `openClaudeDesign`, `ralph`
- Delivery workflows: `rpi` and `prd-oriented`, with optional research,
  approval checkpoints, structure outlining, and phase-by-phase implementation
- Skills: `prompt-engineer`, `research-codebase`, `skill-creator`, `impeccable`,
  `create-spec`

## RPI and PRD-Oriented workflows

Inspect their inputs and launch either workflow from an interactive pi session:

```text
/workflow inputs rpi
/workflow rpi task="Implement the requested change"
/workflow rpi task="..." include_research=true
/workflow rpi task="..." detailed_plan=true
/workflow rpi task="..." iteration_context="fork"
/workflow prd-oriented task="Design and implement the requested product change"
```

`rpi` runs design discussion → structure outline → implementation.
`prd-oriented` runs PRD → technical design → structure outline → implementation.
Set `include_research=true` to prepend research questions and research. Set
`detailed_plan=true` to add a detailed plan and use `implement-plan` instead of
the default `implement-outline` path.

Each logical skill stage may conduct multiple one-question human turns. The
default `iteration_context="fresh"` starts every turn in a clean Pi session and
re-grounds it from a validated, bounded, SHA-256-checked handoff. The optional
`iteration_context="fork"` preserves the preceding matching-stage transcript as
a rollback mode. The selected policy is persisted for pause/resume and cannot
change during a run. Every completed stage—and every implementation phase
requested by its skill—pauses for explicit human review before advancing.

The complete applicable `SKILL.md` is injected into every turn byte-for-byte.
The vendored skills, templates, and agent contracts are protected by
`workflows/assets/asset-lock.json`; integrity failures stop the workflow.

Both workflows use interactive approval checkpoints and must be run
interactively. They operate in the invocation directory and do not create
worktrees or branches, commit, push, or open pull requests.

Delegated research and implementation specialists use the separately installed
[`pi-task`](https://github.com/Shreyasd10/pi-task) `task` tool. Install pi-task
and the `my-workflow-2` named agents before running these delivery workflows:

```bash
pi install git:github.com/Shreyasd10/pi-task
# From a my-workflow-2 checkout:
./install.sh --runtime pi --global --skills-agents-only --verify
```

The workflow also requires the eight matching `my-workflow-2` agent contracts
under `~/.pi/agent/agents`. Preflight verifies their checksums against the
vendored contracts. A missing or different agent blocks the run before its first
stage. Delegation exposes `task` but not `subagent` or `ask_user_question`; the
workflow does not fall back to `pi-subagents` or inline specialist execution.

## Authoring

Workflow files are TypeScript modules that default-export a `workflow({...})`
definition. The extension aliases `@bastani/workflows` (and
`@bastani/workflows/builtin`, `typebox`) to in-memory surfaces, so authoring
imports work without installing anything extra:

```typescript
// ~/.pi/agent/workflows/summarize-pr.ts
import { workflow } from "@bastani/workflows";
import { Type } from "typebox";

export default workflow({
  name: "summarize-pr",
  description: "Summarize a pull request in one task.",
  inputs: {
    pr_url: Type.String({ description: "URL of the pull request to summarize." }),
  },
  outputs: {
    summary: Type.String({ description: "One-task summary of the pull request." }),
  },
  run: async (ctx) => {
    const summary = await ctx.task("summarize", {
      prompt: `Summarize the pull request at ${String(ctx.inputs.pr_url)} clearly and concisely.`,
    });
    return { summary: summary.text };
  },
});
```

Discovery paths (project first, then global):

- `.pi/workflows/*.{ts,js,mjs,cjs}` (project)
- `~/.pi/agent/workflows/*.{ts,js,mjs,cjs}` (global)
- `.pi/extensions/workflow/config.json` / `~/.pi/agent/extensions/workflow/config.json`
  register extra search paths under `workflows.<name>.path`
- Installed packages via `pi.workflows` / `atomic.workflows` metadata or
  conventional `workflows/` directories

After adding or editing workflow files, run `/workflow reload` (or the workflow
tool's `reload` action) to rescan.

## Coexistence

- **pi-task**: no conflicts — different tool (`task` vs `workflow`), different
  command (`/tasks` vs `/workflow`), different UI surface (Ctrl+T vs F2).
  Workflow stage sessions inherit installed package tools, so pi-task's `task`
  tool is available inside stages.
- **my-workflow-2**: skills-only install; skill names are disjoint, and it
  registers no tools or commands.

## Upgrading

This repo is vendored from `@bastani/atomic`. To track a newer release:

1. `npm pack @bastani/atomic@<version>` in a temp dir
2. Extract `package/dist/builtin/workflows` over this repo (keep `package.json`,
   `README.md`, `.gitignore` local)
3. Bump the `@bastani/atomic` dependency to the same `<version>`
4. `npm install && npm test` (if applicable), commit, tag `v<version>`

## License

MIT — upstream `@bastani/workflows` is MIT; see `LICENSE` and
`CHANGELOG.md` for the upstream history.
