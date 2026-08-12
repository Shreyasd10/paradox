---
name: onboard
description: "Build or refresh a workspace index and reusable thin repository profiles for multi-repo brownfield work. Asks then writes to coordinator docs (never hardcodes a folder named workspace). Offers map-codebase next."
disable-model-invocation: true
---

# Onboard

Use when workspace profiles are **missing or stale** for multi-repo / unfamiliar brownfield. Skip when thin profiles are fresh and sufficient — go to `create-research` or `create-plan`.

You are tasked with creating a reusable workspace index + **thin** repository profiles so ticket work does not rescan every microservice from scratch. Keep this skill light — deep per-concern maps belong in `map-codebase`.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If coordinator path or repo list was provided, skip the default message
   - Begin locator dispatch

2. **If no parameters provided**, respond with:
```
I'll build or refresh thin workspace profiles. Please provide:
1. Which repos matter (or "all siblings under the coordinator")
2. Whether to reuse existing profiles when commit matches
3. Any known coordinator docs path override

Tip: Deep single-repo maps are a separate `map-codebase` step after onboard.
```

Then wait for the user's input (or proceed with locator + ask-then-default).

## Process Steps

### Step 1: Locate coordinator root

1. Dispatch `workspace-locator` to detect a **candidate** `coordinator_root` (parent of sibling git repos, or cwd). **Never hardcode** a folder named `workspace`.
2. Propose default docs path: `<coordinator_root>/docs/context/`.
3. **Always ask** the user (**ask-then-default**): accept default, skip → default, or override with another path.
4. Record chosen path as `coordinator_docs` (and `coordinator_root`) in the workspace index frontmatter.

### Step 2: Write index + thin profiles

Write **only** under the chosen path:
- Workspace index: `<coordinator_docs>/workspace-index.md`
- Thin profiles: `<coordinator_docs>/profiles/<repo-id>.md`

`onboard` exclusively owns these coordinator files. Other skills may read them, but must return pointers or findings instead of modifying them.

**Do not** write sibling profiles into the my-workflow-2 **skill repo** (or any skill-install path) by default. Only if the user explicitly overrides `coordinator_docs` to that location.

Dispatch `repo-profiler` per selected repo (parallel when possible). Pass `<coordinator_docs>/profiles/` as the profiler output path. Inline fallback on runtimes without subagents.

For each repo, record: identity, local path, ownership (if known), availability, default branch, observed revision/commit.

**Existing profiles:** same repo identity + commit and clean inputs → offer **reuse** vs **refresh** — do not duplicate silently.

**Invalidate / refresh when:** observed commit changed, working tree dirty relative to profile inputs, or user requests refresh.

Profile contents (revision-scoped, thin): stack, topology, conventions, testing approach, integrations, freshness, evidence paths, confidence; optional `deep_map_path` if a deep map exists.

### Step 3: One-time migration (if needed)

If `docs/context/workspace-index.md` and/or `docs/context/profiles/*` exist under the my-workflow-2 (or skill) repo and look like multi-repo coordinator artifacts:

1. Complete ask-then-default so `coordinator_docs` is chosen.
2. Show what will move; ask before delete.
3. Prefer **move** index + profiles to `<coordinator_docs>/`, then fix frontmatter.
4. Leave a short README pointer under the old path, or remove empty dirs after user confirm.
5. Exit criteria: sibling profiles live only under chosen coordinator docs; `coordinator_root` is not the skill repo unless the user explicitly chose that.

### Step 4: Hand off

Offer `map-codebase` next for any repo that needs deep single-repo depth; offer `create-research` or `create-plan` when the user has a concrete ask. Never auto-invoke without the user's go-ahead.

## Important Guidelines

1. Cache is an optimization; cache failure never blocks a fresh profile pass
2. Profiles are authoritative only for the recorded revision; mark `stale` when invalidated
3. Never hardcode a required path segment named `workspace`
4. Never auto-deep-map every sibling on every onboard
5. Keep profiles reusable and concise — not ticket-specific dumps
6. Memory hits for prior profiles are leads only — verify against the live tree
