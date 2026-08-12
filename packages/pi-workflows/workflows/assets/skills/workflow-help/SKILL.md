---
name: workflow-help
description: Analyze project state and recommend the next my-workflow-2 skill. Use for orientation, what-next, and workflow questions.
disable-model-invocation: true
---

# Workflow Help

Use when the user asks **what should I do next**, **where am I**, **help**, or wants orientation. Skip when the next skill is already clear — invoke it directly.

## Purpose

Orient the user and recommend the next skill. Pure chat — does **not** write to `docs/`.

## Desired outcomes

1. Know current stage and relevant artifacts
2. Know next recommended / required skill
3. Know how to invoke it
4. Offer to run the clear next step (do not auto-invoke)
5. Answer workflow questions from this catalog and other `skills/*/SKILL.md` files

## Data sources

- Skill catalog below + `skills/*/SKILL.md`
- Artifacts under `docs/{research,design-discussions,prd,technical-design,outlines,plans,handoffs,solutions}` and coordinator `docs/context/`
- Deep map signal: `<repo>/docs/context/codebase/` → prefer map reuse

## Skill catalog (18)

| Skill | Purpose | Writes to |
|---|---|---|
| `workflow-help` | This skill | (none) |
| `onboard` | Workspace index + thin profiles | coordinator docs / profiles |
| `map-codebase` | Deep single-repo map | `<repo>/docs/context/codebase/` |
| `wayfinder` | Map multi-session uncertainty as decision tickets | issue tracker or `docs/wayfinder/` |
| `prototype` | Answer one design question with runnable code | local prototype / throwaway |
| `create-research-questions` | Write a query plan for research | `docs/research/` |
| `create-research` | Gather objective codebase facts | `docs/research/` |
| `create-design-discussion` | Align on current → desired design | `docs/design-discussions/` |
| `create-prd` | Product requirements document | `docs/prd/` |
| `create-technical-design` | Technical Design Document (how to build) | `docs/technical-design/` |
| `create-structure-outline` | Vertical delivery phases + per-unit test modes | `docs/outlines/` |
| `create-plan` | Optional code-level implementation plan | `docs/plans/` |
| `implement-outline` | **Default** execute outline phases (Iron Law) | updates the outline |
| `implement-plan` | Execute detailed plan / oneshot (Iron Law) | updates the plan |
| `handoff` | Intentional compaction for a fresh session | `docs/handoffs/` or topic handoff |
| `resume-handoff` | Resume from a handoff | (none) |
| `wiki` | Durable wiki / knowledge pages | wiki paths per skill |
| `compound` | Capture durable learnings after work is done | `docs/solutions/` |

## Invocation paths

**Default RPI**

```text
(onboard → map-codebase) → (wayfinder → prototype)?
→ create-research-questions → create-research
→ create-design-discussion
→ create-structure-outline
→ implement-outline
→ (compound)?                 # after feature/bug solved
```

**Default PRD-oriented**

```text
… → create-prd → create-technical-design
→ create-structure-outline
→ implement-outline
→ (compound)?
```

**Optional detailed-plan path** (code-level steps)

```text
… → create-structure-outline
→ create-plan
→ implement-plan
→ (compound)?
```

**Oneshot**

```text
implement-plan         # STOP and ask if test mode missing
→ (compound)?
```

## Routing notes

- Default build path after an approved outline is `implement-outline`, not `create-plan`.
- Use `create-plan` → `implement-plan` only when exact code-level steps are needed.
- `compound` runs at the **end**, after the feature/bug is implemented or solved; evidence = phase checks + user done-OK (no verification report required).
- Git/GitHub mutations are always user-owned — skills suggest commands only.
- Iron Law: plans/outlines declare `tdd` | `characterization-then-tdd` | `exempt`; implement skills hard-gate RED before GREEN.

## State detection

Walk in order; first hit wins:

1. Active Wayfinder map → `wayfinder`
2. Unfamiliar multi-repo / no profiles → `onboard` / `map-codebase`
3. Fresh handoff with named next step → `resume-handoff`
4. Draft research questions → finish `create-research-questions`
5. Draft research → finish `create-research`
6. Draft design discussion with open questions → finish `create-design-discussion`
7. Draft/in-review PRD → finish `create-prd`
8. Draft/in-review technical design → finish `create-technical-design`
9. Draft/in-review outline → finish `create-structure-outline`
10. Approved outline, no detailed plan needed → `implement-outline`
11. Draft/in-review detailed plan → finish `create-plan`
12. Approved detailed plan → `implement-plan`
13. In-progress outline or plan → continue implementation
14. Implementation done, learning candidate → `compound`
15. Else: ask whether facts (`create-research`), design (`create-design-discussion`), or delivery (`create-structure-outline`) are open

## Response format

- Skill name in backticks, one-line purpose, required vs optional, suggested inputs, offer to run
- Optional items first, then next required
- Never auto-invoke
