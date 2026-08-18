# Human writing

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
