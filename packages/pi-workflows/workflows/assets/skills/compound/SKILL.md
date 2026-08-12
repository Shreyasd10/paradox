---
name: compound
description: "Capture one verified post-work learning in docs/solutions/ with overlap detection, source grounding, and optional memory or Obsidian summaries."
disable-model-invocation: true
---

# Compound

Capture one verified, reusable learning after implementation or debugging. Skip trivial one-offs and unverified hypotheses.

The repository artifact is authoritative. Memory and optional Obsidian output are retrieval aids only.

**One learning per run.** If a session produced several distinct learnings, run this skill once for each.

## Preconditions

- The problem or decision is solved and verified.
- Evidence exists in tests, a validation report, source citations, or an explicit manual check.
- The learning is durable enough to help with a future implementation or investigation.

If the work is still in progress, the learning cannot be saved as complete. Ask the user to return after verification.

## Modes

Use the argument text as the topic, plan path, or validation path when provided.

| Mode | Behavior |
|---|---|
| Interactive | Ask for missing context and optional Obsidian publication using the host's blocking question tool when available. |
| `mode:lightweight` | One-pass extraction and write. Skip subagents and semantic grounding. |
| `mode:headless` | Full workflow without blocking questions. Apply safe maintenance edits silently and emit a structured report. |

The host may expose different question, subagent, and shell interfaces. Use the runtime's native tools when available, otherwise execute the agent prompt inline. Do not assume Claude, Cursor, the coding agent, or runtime-specific command names.

## Phase 1: Extract and Research

1. Read any supplied plan, validation report, research note, or code references fully.
2. Extract the problem, symptoms, failed approaches, root cause, solution, prevention, affected repositories, and verification evidence.
3. Classify the learning:
   - **Bug track:** recurring failures and fixes.
   - **Knowledge track:** business rules, workflow guidance, patterns, conventions, tooling decisions, and architecture constraints.
4. Search `docs/solutions/` freshly for related documents. Use `codebase-locator` when available, then `codebase-analyzer` for strong matches.
5. Ground factual code-behavior claims in the current source with `file:line` citations. Soften claims that cannot be verified.

### Full-mode parallel research

When the host supports subagents, dispatch these read-only prompts in parallel. Each agent writes its full result to a scratch file and returns the path:

- `skills/compound/references/agents/compound-context-analyzer.md`
- `skills/compound/references/agents/compound-solution-extractor.md`
- `skills/compound/references/agents/compound-related-docs-finder.md`

Pass the repository root, topic, scratch directory, and relevant support-file contents. Subagents must not edit product files or tracked paths. If no subagent primitive exists, perform these roles inline.

Use the repository's existing `agents/repo-profiler.md` only when a fresh repository orientation is needed. It is an orientation aid, not a source of topic-specific conclusions.

### Optional session history

Session history is optional and must never be required for correctness. When the runtime exposes session files, use the bundled discovery and extraction scripts under `skills/compound/scripts/session-history/`, then dispatch `skills/compound/references/agents/compound-session-historian.md` with only extracted scratch paths. Never read raw session files directly in the synthesizer.

## Phase 2: Assemble and Write

### Output contract

Write exactly one canonical learning under:

```text
docs/solutions/YYYY-MM-DD-<slug>.md
```

Use `templates/docs/solutions/TEMPLATE.md`. Preserve its frontmatter contract:
Required for business rules: rule statement, evidence, affected services, confidence, freshness.
- `status: complete` only after verification
- `authority: learning`
- `freshness` and `last_updated`
- `source_links`, `related`, and `links`

For bug learnings, include Problem, Symptoms, What Didn't Work, Root cause, Solution, Why This Works, Prevention, and Verification evidence. For knowledge learnings, include Context, Guidance, Why This Matters, When to Apply, Examples, and Verification evidence.

### Overlap policy

- **High overlap:** update the existing document instead of duplicating it. Preserve its path and add `last_updated`.
- **Moderate overlap:** create the new document and cross-link the existing one.
- **Low or no overlap:** create the new document.

Before writing, read the relevant template and preserve the repository's field names. Do not import the source plugin's `problem_type`, `component`, or category-directory schema unless this repository adopts those fields explicitly.

### Validation

Run these pure-stdlib checks against the written document:

```bash
python3 skills/compound/scripts/validate-frontmatter.py <doc-path>
python3 skills/compound/scripts/validate-doc-claims.py <doc-path>
```
- Include backlinks to the project artifact, repository, and verification evidence
Treat claim-validator flags as adjudication items. Fix bad citations, annotate historical paths, and replace unstable commit-SHA claims with PR or ticket references.

In full or headless mode, use `skills/compound/references/agents/compound-grounding-validator.md` for a semantic read-only pass when a subagent is available. Lightweight mode skips this pass.

### Discoverability

Check root `AGENTS.md` and `CLAUDE.md` for whether agents can discover `docs/solutions/`, its YAML frontmatter, and when it is relevant. In interactive mode, ask consent before a minimal instruction-file edit. In headless mode, apply the smallest safe edit. Do not create a new instruction file just for this check.

If `CONCEPTS.md` already exists, check whether it is discoverable from the root instructions. Do not bootstrap a glossary automatically; that is a separate project decision.
- Design/trade-off decisions made during optional `create-design-discussion` stay in brainstorm artifacts; compound captures what proved true after implement/validate.
## Optional integrations

- If agentmemory is available, save only a concise pointer after the repository document passes validation. Memory is not authoritative.
- If the user explicitly requests Obsidian publication and the `obsidian-vault` capability is available, publish only the user-selected concise summary with backlinks. Never publish full transcripts or plans by default.
- If Obsidian is unavailable, skip publication and complete the repository artifact normally.
2. **Evidence required** — no complete status on guesses
## Completion report

Interactive mode reports the document path, whether it was created or updated, overlap result, validation result, stale-document candidates, and optional integration status.

Headless mode ends with:

```text
Documentation complete
File: <path>
Track: bug | knowledge
Overlap: none | low | moderate | high
Validation: clean | flags adjudicated | degraded
Memory: saved | skipped
Obsidian: published | skipped
```