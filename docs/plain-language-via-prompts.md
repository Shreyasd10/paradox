# Plain language via prompts, not a second model

Status: accepted

## Context

Chat replies and files under `docs/` were hard to read. A second-model rewrite of each bubble was on the table. That path adds a network call, a wait, and a redraw.

ADHD mode already shapes chat: action first, numbered steps. It does not shape files that skills write. Bundled writing skills had a short copy-pasted paragraph. Top-level `create-plan` had none, so a model that follows the skill will ignore ADHD for the artifact.

## Decision

One shared plain-language block. ADHD loads it for chat. Skills that write `docs/` files include it at the top of the skill. Write plainly the first time.

Do not build a second-model chat swap unless this still fails.

## Consequences

- Chat and artifacts use the same wording. The next skill reads the text the user already read.
- Paths, commands, phases, and test modes stay exact.
- No sibling `.plain.md`. No rewrite of old files in this version.
- Second-model display rewrite and local extra models stay parked.
