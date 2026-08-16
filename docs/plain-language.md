# Plain language

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
