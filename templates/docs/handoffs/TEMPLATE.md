---
artifact_id: handoff:replace-with-slug
family: handoff
path: docs/handoffs/replace-with-slug.md
authority: {"owner":"workflow","scope":"durable continuation point"}
status: active
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-01-01T00:00:00Z
freshness: {"checked_at":"2026-01-01T00:00:00Z","repository_state":"replace-with-revision-or-working-tree-marker","status":"fresh"}
continuation_point: "Replace with the first incomplete bounded action."
lineage: [{"relation":"continues","artifact_id":"execution-ledger:replace-with-run","path":"docs/ledgers/replace-with-run.json","required_status":"complete"}]
---

# Handoff: Replace With Title

## Current State

- **Request:** Replace with the bounded request.
- **Repository state:** Replace with the read-only status and diff observation.
- **Continuation point:** Replace with the next incomplete job.

The continuation point in frontmatter is the machine-readable first incomplete
bounded action. Update the freshness checkpoint whenever this handoff is
reconciled with the repository.

## Authoritative Artifacts

The frontmatter `lineage` is the portable artifact lineage for this handoff.

| Family | Path | Status | Why authoritative |
| --- | --- | --- | --- |
| Verification | `docs/verification/replace-with-report.md` | `complete` | Independent proof for the request. |

## Evidence

| Type | Command or reference | Outcome |
| --- | --- | --- |
| Automated | `replace with exact command` | `passed` / `failed` / `not-run` |

## Blockers

- None, or list each blocker with its location and consequence.

## User-Run Next Actions

List exact commands or review actions the user may perform. They are shown for
the user and are not executed by the workflow.
