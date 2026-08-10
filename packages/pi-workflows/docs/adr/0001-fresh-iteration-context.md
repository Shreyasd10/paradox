---
status: accepted
---

# Default built-in loops to fresh iteration context

Built-in workflow loops will start repeated roles in fresh sessions by default and restore continuity from bounded, hash-verified handoff manifests plus immutable evidence snapshots. Forked transcripts caused context growth and attention dilution; deterministic external state preserves the run contract and audit trail without carrying assistant reasoning or tool chatter forward.

## Considered options

- **Fresh context with authoritative handoffs** — selected for bounded context, deterministic replay, and explicit continuity.
- **Fork every matching role** — retained temporarily as an explicit per-run rollback mode because it preserves conversational history but grows context and carries prior-agent bias.
- **Compact then fork** — rejected because model-generated compaction is lossy and less deterministic than structured workflow state.
- **Intercom handoff** — rejected for sequential continuity because it is a live messaging channel and received messages still consume transcript context.

## Consequences

Ralph, Goal, and Open-Claude-Design must persist complete authoritative handoffs before admitting another iteration. Existing runs retain their launch-time behavior; new runs default to fresh context, with fork mode available for two minor releases pending telemetry and regression evidence.
