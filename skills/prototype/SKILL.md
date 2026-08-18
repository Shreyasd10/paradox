---
name: prototype
description: "Build a bounded, runnable code experiment to answer one design or architectural question. Use directly or from a Wayfinder Prototype ticket; capture the verdict, not a long specification."
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


# Prototype

Use when a design, state model, integration boundary, or UI cannot be judged reliably from prose. A prototype is a small code experiment that answers **one explicit question**. It is evidence for a decision, not a shortcut to shipping unreviewed production code.

Use directly for a focused question, or from a Wayfinder Prototype ticket. In Wayfinder, the ticket must name the question, the smallest useful experiment, and the observable verdict it needs.

## Choose the shape

- **Logic prototype** — use [LOGIC.md](LOGIC.md) for state transitions, data models, APIs, and integration boundaries.
- **UI prototype** — use [UI.md](UI.md) for visual hierarchy, interaction, or page layout.

If both apply, start with the uncertainty that blocks the other. If the question is unclear, ask the user; otherwise choose based on the surrounding code and state the assumption in the prototype.

## Rules

1. State the question and the expected observation before writing code.
2. Build the smallest runnable experiment in the host project's language and tooling. Do not add a runtime, package manager, or persistence unless that is the question.
3. Keep it close to the code it informs and clearly name it as a prototype.
4. Make it runnable with one project-native command and surface the relevant state or variation after each interaction.
5. Skip polish, generalized abstractions, and production-grade tests. The goal is learning quickly.
6. Iterate tightly: implement, inspect, refactor the experiment, and update the question if the evidence changes it.
7. Capture the answer in the originating issue, Wayfinder ticket, or decision record: question, verdict, and a link to the code evidence. Keep that summary brief.
8. Do not promote prototype code wholesale. Move only validated, portable logic into production through the normal planning and implementation workflow; discard or preserve the experiment on a clearly named throwaway branch.

## Completion

A prototype is complete when its question has a verdict. Report the verdict, its evidence, and the next decision it enables. If the question remains open, say why and narrow the next experiment rather than producing a speculative specification.
