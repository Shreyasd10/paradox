---
name: map-codebase
description: "Deep-map one repository into seven per-concern docs under that repo's docs/context/codebase/. Spawns four codebase-mapper focuses in parallel. Offer after onboard or when single-repo depth is needed."
disable-model-invocation: true
---

# Map Codebase

Use when you need a **deep single-repo map** (after onboard or when thin profiles aren’t enough). Skip when thin profiles suffice — does not replace `onboard`.

You are tasked with producing a **deep single-repo map** so planning can load per-concern evidence instead of re-scanning from scratch.

**Not** a thin onboard profile. **Not** execute-phase / autonomous waves. **Never auto-commit.**

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a `repo_id` or absolute path was provided, skip the default message
   - Begin resolve + freshness check

2. **If no parameters provided**, respond with:
```
I'll deep-map one repository into docs/context/codebase/. Please provide:
1. Repo id and/or absolute path
2. Refresh / Update / Skip preference if a map already exists
3. Optional coordinator context if repo resolution needs an existing workspace index
Tip: Thin multi-repo profiles stay in onboard; this skill is single-repo depth only.
```

Then wait for the user's input.

## Process Steps

### Step 1: Resolve target repo

Resolve `repo_id` and/or absolute path (from coordinator index, or explicit user path). If missing / unavailable → **fail clearly**; do not invent a map.

Read observed commit (`git rev-parse HEAD`) and note dirty state if relevant.

### Step 2: Freshness gate

**Existing map** at `<repo>/docs/context/codebase/`:
- Same `observed_commit` + clean inputs → offer **Refresh / Update / Skip** (never silent overwrite)
- Commit changed, dirty relative to map inputs, or user requests refresh → proceed

### Step 3: Ensure output tree

```
<repo>/docs/context/codebase/
  STACK.md
  ARCHITECTURE.md
  STRUCTURE.md
  CONVENTIONS.md
  TESTING.md
  INTEGRATIONS.md
  CONCERNS.md
```

Use templates under `templates/docs/context/codebase/`. Each file needs usable content (template sections present; typically >20 lines) and frontmatter with `observed_commit` + `freshness`.

### Step 4: Dispatch mappers

Spawn **four** `codebase-mapper` agents in parallel (same agent, different `focus`):

| Focus | Writes |
|---|---|
| `tech` | STACK.md, INTEGRATIONS.md |
| `arch` | ARCHITECTURE.md, STRUCTURE.md |
| `quality` | CONVENTIONS.md, TESTING.md |
| `concerns` | CONCERNS.md |

**Navigation:** LeanCTX-first when the runtime exposes LeanCTX (structural/search before broad native reads); otherwise existing generic tools. Preserve this four-focus orchestration either way.

Mappers write files directly and return **confirmation + line counts only** (never dump document bodies back to the orchestrator).

**Subagents unavailable:** run the four focuses **sequentially inline** using `agents/codebase-mapper.md` — still produce all seven files.

Pass: focus, today's date, repo path, `observed_commit`.

### Step 5: Verify & pointer

1. Collect confirmations only; verify all **seven** files exist with template sections / usable size.
2. Return the deep-map path to the caller. Do not modify coordinator indexes or thin profiles; `onboard` exclusively owns those files and may record this path during a later profile refresh.
3. **Offer** a git commit in the **target** repo for the seven files — never auto-commit.
4. Offer next skill: `create-research` (reuse this map), optional `create-design-discussion` if design is open, `create-plan`, or stop.

## Deferred (do not implement)

- `--fast` (4-file) map tier
- Incremental `--paths` remap / post-execute drift auto-remap
- Intel / `--query` / execute-phase automation

## Important Guidelines

1. **One repo per run**
2. **CONCERNS** is evidence-backed debt/risk only — no drive-by refactor recommendations
3. Thin profiles stay authoritative for multi-repo selection; deep maps are in-repo depth
4. This skill exclusively owns `<repo>/docs/context/codebase/`; other skills may read those files but must not invoke `codebase-mapper` to write them.
5. Never vendor external execute/ship automation into this skill
6. Never auto-commit map outputs
