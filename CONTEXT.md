# paradox

Shared terms for this pack.

**Artifact**:
A markdown file a workflow skill writes under `docs/` (plan, design discussion, technical design, outline, and the rest). The next skill reads it.

**Plain-language block**:
Shared writing rules: everyday words, one idea per sentence, explain jargon on first use, keep every path, command, phase, and test mode. Simplify wording, never substance. Canonical file: `docs/plain-language.md`.

**ADHD mode**:
Chat style: action first, numbered steps. Also loads the plain-language rules. Does not by itself rewrite files under `docs/`.

**Prompts, not a second model**:
Plain language is a writing rule in ADHD and in skills that write artifacts. There is no extra model call that rewrites the chat bubble. See `docs/plain-language-via-prompts.md`.
