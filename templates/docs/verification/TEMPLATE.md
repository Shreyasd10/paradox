---
schema_version: 1
artifact_id: verification:replace-with-slug
family: verification
path: docs/verification/replace-with-slug.md
authority: {"owner":"validation","scope":"independent implementation verification"}
status: draft
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-01-01T00:00:00Z
lineage: [{"relation":"validates","artifact_id":"execution-ledger:replace-with-run","path":"docs/ledgers/replace-with-run.json","required_status":"complete"}]
source_request: "replace with request or issue reference"
implementation_evidence: "replace with implementation result or handoff"
---

# Verification: Replace With Title

## Verdict

- `final_status`: `draft | passed | failed | blocked`
- `spec_verdict`: `proved | partially-proved | not-proved`
- `quality_verdict`: `acceptable | findings | unacceptable`
- `independent_validator`: `replace with validator identity`
- `validated_at`: `replace with timestamp`

## Observable Truths

| ID | Requested outcome | Status | Evidence |
| --- | --- | --- | --- |
| `OUT-1` | Replace with an observable truth. | `proved` / `partially-proved` / `not-proved` | Command, file, or observation reference. |

## Command Evidence

| Command | Exit/result | Observation |
| --- | --- | --- |
| `replace with exact command` | `passed` / `failed` / `not-run` | Relevant output or reason. |

## Findings

| Severity | Location | Consequence | Next action |
| --- | --- | --- | --- |
| `none` | `n/a` | `No blocking finding.` | `n/a` |

## Manual Checks

| Check | Status | Evidence or reason |
| --- | --- | --- |
| Replace with a user-run check. | `pending` / `passed` / `unattended-skipped` | Replace with evidence. |

## Result

State why the independent verdict follows from the evidence. List blockers and
the smallest user-owned next action when the result is not `passed`.
