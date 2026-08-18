---
name: handoff
description: Record a durable repository-local continuation point for work that may resume in another session.
disable-model-invocation: true
---

## Human writing

Follow this block for every sentence you write in this skill (chat and the file under `docs/`). Canonical copy: [plain-language.md](../../docs/plain-language.md).

Write like a teammate explaining the work across a desk. The reader should hear what a person sees, decides, or does. Do not write a tutorial glossary, an ADR, or a requirements matrix.

These rules apply to chat and to files under `docs/`. They do not replace "lead with the next action."

- Chat: the first line is still the next action (a command, path, or decision). Do not open with a glossary.
- One idea per sentence. If a sentence has two dashes or three clauses, split it.
- Everyday words where they exist. Human meaning first, then the machine name: sign-in (`login`), not `the login route`.
- Headers state the takeaway, not a topic label. Bad: `Current State`. Good: `The advertised tool looks like it takes no arguments`.
- Keep every fact a specialist needs: file paths, commands, flags, phase names, test modes (`tdd`, `characterization-then-tdd`, `exempt`), line numbers, and caveats. Do not invent a synonym for those.
- Do not cite FR/NFR/ADR/ARC numbers unless the reader must open that file. Prefer `Per the ticket` or `The research doc notes`.
- Keep full depth. Plain words, not less content.
- If a sentence needs a second read, rewrite it.
- Do not write a sibling `.plain.md`. Write it plainly the first time.

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
