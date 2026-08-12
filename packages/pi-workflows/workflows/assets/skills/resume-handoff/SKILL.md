---
name: resume-handoff
description: Reconcile a repository-local handoff with live state and resume from its first incomplete bounded action.
disable-model-invocation: true
---

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
