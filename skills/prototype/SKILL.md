---
name: prototype
description: "Build a bounded, runnable code experiment to answer one design or architectural question. Use directly or from a Wayfinder Prototype ticket; capture the verdict, not a long specification."
disable-model-invocation: true
---

## Plain language

Follow this block for every sentence you write in this skill (chat and the file under `docs/`). Canonical copy: [plain-language.md](../../docs/plain-language.md).

Always assume the reader is a junior developer who is new to this repo and to this topic. They need explaining. Do not skip a definition because they might already know the word, or because you already defined it earlier.

Write so that reader can act on the text. Keep every fact a specialist needs to execute.

These rules apply to chat and to files under `docs/`. They do not replace "lead with the next action."

- Chat: the first line is still the next action (a command, path, or decision). Do not open with a glossary.
- One idea per sentence. Everyday words where they exist.
- Short headed sections. A header states the takeaway, not a topic label. Bad: `Current State`. Good: `The advertised tool looks like it takes no arguments`.
- Every time you use a word a junior new to this repo would not know, explain it in that same sentence. Do not explain only the first time. The reader will not remember. If you are unsure whether they know it, they do not. Bad: `Normalize in wrapToolDefinition.` Good: `Normalize means rewrite the schema into an object with a properties list so providers can advertise it, without changing which arguments are valid. Do that rewrite in wrapToolDefinition.`
- Do not invent a synonym for a path, command, flag, phase name, test mode, or file name.
- Keep all of: file paths, commands, flags, phase names, test modes (`tdd`, `characterization-then-tdd`, `exempt`), line numbers, and caveats.
- Simplify wording. Never cut depth, options, or tradeoffs.
- If a sentence needs a second read, rewrite it.
- Do not write a sibling `.plain.md`. Do not wait for another model to rewrite the reply. Write it plainly the first time.

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
