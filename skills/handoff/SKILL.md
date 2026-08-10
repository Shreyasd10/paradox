---
name: handoff
description: Record a durable repository-local continuation point for work that may resume in another session.
disable-model-invocation: true
---

# Handoff

Use this skill when work pauses, a session changes, or another person or agent
needs a precise continuation point.

## Contract

- Inspect live repository state read-only before writing the handoff.
- Treat repository-local artifacts and command evidence as authoritative; runtime
  memory is context only.
- Write one handoff under `docs/handoffs/` using the handoff template.
- Link every authoritative input with a portable artifact lineage entry.
- Record freshness at the same checkpoint as the repository inspection.
- State the first incomplete bounded action, blockers, and exact user-run next
  actions. Do not imply that Git or remote-host mutations were performed.

## Required Handoff Content

The handoff must include:

- current request and read-only repository state;
- `freshness` with the inspection time, repository state identifier, and
  `fresh`/`stale` status;
- authoritative artifacts and why each is authoritative;
- command and observation evidence;
- a continuation point naming the first incomplete bounded action;
- blockers and consequences, or an explicit none;
- user-run commands or review actions that are not executed by this skill.

Use `status: active` for resumable work, `status: blocked` when a blocker stops
continuation, and `status: complete` only when no bounded action remains.

## Git Safety

Read-only status and diff inspection are allowed. Do not create branches or
worktrees, stage, commit, push, create pull requests, or mutate remote state.
