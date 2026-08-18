---
name: resume-handoff
description: Reconcile a repository-local handoff with live state and resume from its first incomplete bounded action.
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

# Resume Handoff

Use this skill when a handoff identifies work to continue.

## Procedure

1. Locate the requested handoff under `docs/handoffs/` and read its metadata,
   lineage, continuation point, evidence, and blockers.
2. Inspect the live repository state, including status, relevant files, and linked artifact
   timestamps without changing Git or remote state.
3. Mark the handoff stale when the repository or an authoritative linked artifact
   is newer than the handoff freshness checkpoint, or when its claims no longer
   match live files.
4. Reconcile stale claims explicitly. Do not silently reuse outdated evidence or
   runtime memory.
5. If the work is blocked, report the blocker and the smallest user-owned action
   that can remove it. If it is complete, report the proof and do not restart it.
6. Otherwise continue only from the first incomplete bounded action named by the
   handoff. Preserve the parent skill's test mode, evidence, and Git-safety
   policy.

## Result

Return the handoff path, freshness classification, live-state observations,
reconciled artifacts, the selected bounded action, and any blockers. A resume
does not treat conversation or runtime memory as an authority and does not
create a new plan merely because the session changed.

## Git Safety

Inspection is read-only. Never create branches or worktrees, stage, commit,
push, create pull requests, or mutate remote state.
