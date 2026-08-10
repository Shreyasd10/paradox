# Workflow orchestration

Language for continuity between repeated workflow stages without treating conversation history as durable state.

## Language

**Iteration context**:
The continuity policy used when the same role runs again in a later iteration.

**Fresh iteration context**:
The repeated role starts without an inherited conversation and regains continuity from an authoritative handoff.

**Forked iteration context**:
The repeated role starts from a branch of its prior conversation and therefore inherits that transcript.

**Handoff manifest**:
A bounded, structured index of authoritative state that the next iteration can trust and use to locate detailed evidence.
_Avoid_: Chat summary, transcript summary

**Authoritative state**:
The original run contract, verbatim user amendments, accepted decisions, unresolved findings, validation status, rejected approaches with reasons, and evidence references. Assistant reasoning and conversational residue are excluded.

**Evidence artifact**:
A durable record containing detail that can be inspected when the handoff manifest identifies it as relevant.

**Amendment journal**:
The append-only record of user-authored changes to a run contract that must cross iteration boundaries verbatim.
