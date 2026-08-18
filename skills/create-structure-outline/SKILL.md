---
name: create-structure-outline
description: Only use when the user explicitly invokes this skill by name.
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


# Create Structure Outline

You are creating a phased implementation plan based on research findings and design decisions.

## Input

- If only a directory is provided, or a directory is not provided, check the task's artifact directory from your prompt: `ls docs/outlines/` slug>`. Do NOT use grep or glob or `ls` or `ls -l`, as the directory may be a symlink.
- If not directory is provided, and you do not know the task's artifact directory, you should ask the user what artifacts they would like for you to create the outline from.

## Steps

1. **Read all input documents FULLY**:
   - Use Read tool WITHOUT limit/offset to read the research document
   - Understand the current state of the codebase from research findings
   - Review all design decisions and patterns to follow
   - **DO NOT read research questions documents** - research questions are inputs to the research phase only. Use the completed research document instead.

2. **Check for related task content**:
   - If a path in `docs/outlines/` is mentioned, use `ls docs/outlines/`
   - Read all files in the task directory except research questions documents
   - Read relevant files mentioned in the task files

3. **Spawn sub-agents for follow-up research if necessary**:

   **For deeper investigation:**
   - **codebase-locator**: Find additional files if needed
   - **codebase-analyzer**: Deep-dive on specific implementations
   - **codebase-pattern-finder**: Find more examples of patterns
   - **web-search-researcher**: Research external best practices

   Do not run agents in the background - FOREGROUND AGENTS ONLY.

4. **Read the visual guidance, then create a phased implementation plan**:
   - Before creating the outline, read `references/show-me.md`
   - Use the smallest set of visual views needed for each phase instead of a list of files and changes
   - Tell the story of each phase in the order that makes it easiest to understand; show files first when ownership gives the needed context, or establish key data structures, SQL tables, or API contracts first when they explain the rest of the change
   - Treat every visual view and subheading as optional. Choose and order them based on the change rather than a fixed template
   - It should be written as one human would write to another
   - Place a short description between visual views so the outline explains why the next shape matters and how it connects to the phase
   - Use a high-level file change tree when file ownership matters, and use focused views for key data structures, SQL tables, or API contracts when those shapes help explain the phase
   - Use `diff` blocks for focused changes to existing shapes; use language-specific or `text` blocks to show complete target shapes when they are new, high-level, or clearer without diff notation
   - Use proper tree glyphs (`├──`, `└──`, and `│`), not ASCII substitutes
   - In `diff` blocks, start added and changed (`~`) lines with `+`, removed lines with `-`, and unchanged context lines with a space
   - Add short notes only where they help explain ownership or behavior
   - Keep the tree small enough to scan. Group related files under their shared directory and omit unchanged paths unless they give needed context
   - Break the work into logical phases
   - Each phase should be independently testable
   - Order phases vertically rather than horizontally - wire everything together in a testable way and then add functionality incrementally

Each phase should ideally be a thin vertical slice that touches all / as many layers as possible for the desired end state. Avoid horizontal phases like 'add all types', 'add API endpoints', 'implement UI'.

Try to find ways to structure the outline so that each phase cuts across multiple layers, services, or module boundaries at least > 1 if at all possible. Each phase should be independently verifiable based on typechecks, tests, build steps, and any other in-repo verification. Ensure you understand codebase patterns for testing and verification, and don't suggest manual testing for a step that could be automated w/ a script, an existing skill, etc.

A horizontal breakdown looks like this:

1. Build the schema
2. Build the API
3. Build the UI
4. Add tests

That creates handoff problems and partially finished work.

A vertical slice cuts through the stack:

1. User can create the simplest version of the thing end-to-end
2. User can edit one field end-to-end
3. User can see the first validation error end-to-end

Each issue should include schema, API, UI, and tests if the slice needs them.

These are intended to be **illustrative**. Not all work lends itself to this type of structure specifically, but you should try to cross module boundaries where able to surface surprises early. Do not structure a phase N such that Phase N+1 must be completed before Phase N can be verified.

5. **For each phase, specify**:
   - Overview of what's being built
   - A compact change outline that shows the relevant file tree, key data structures, SQL tables, API contracts, and tests at the level needed to understand the phase
   - Test changes if the research found testing patterns for the components being modified (e.g. show `+ foo.test.ts # covers the new behavior` in the tree)
   - Validation approach - how we'll verify the phase works

6. **Create the Implementation Overview section**:
   - Add a checkbox list of all phase titles at the top
   - Format: `- [ ] Phase N: [Title]`
   - These get checked off as phases complete during implementation


## Output Document

1. **Read the structure outline template**

`Read(references/structure_outline_template.md)`

2. **Write the structure outline** to `docs/outlines/YYYY-MM-DD-structure-outline-DESCRIPTION.md`
   - First, find the task directory: `ls docs/outlines/` | grep -i "eng-XXXX"`
   - If the directory doesn't exist, create: `docs/outlines/`
   - Format: `YYYY-MM-DD-structure-outline-DESCRIPTION.md` where NN is a zero-padded chronological index and DESCRIPTION is a 2-4 word kebab-case slug
   - **Chronological indexing**: `ls -La` the task directory, find the highest existing NN- prefix, and use the next number. First document = `01-`, second = `02-`, etc.
   - Directory naming:
     - With ticket: `docs/outlines/`
     - Without ticket: `docs/outlines/`

3. **Read the final output template**

`Read(references/structure_outline_final_answer.md)`


## Work with the user to iterate on the design

3. **If the user gives any input along the way**:
   - DO NOT just accept the correction
   - Spawn new research tasks to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself
   - interpret ALL user feedback as instructions to update the document, not to begin implementation
   - Update the structure according to the user's feedback

<guidance>

- The permalink appears as `additionalContext` after Write/Edit/MultiEdit/Read operations
- Use this permalink in your final output for easy navigation
- Example format: `http(s)://{DOMAIN}/artifacts/{artifactId}`

## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like README examples or SKILL.md templates), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example README
## Installation
```bash
npm install example
```
````

## Phase changes should be concise but clear

The goal of this document is to be concise and human readable. 
Be tasteful and thoughtful about how and where you include code snippets, and prefer highlighting signature changes rather than entire code blocks, unless the user explicitly asks for them. The structure outline is our "c header files", the plan will include the function definitions.


## Phase Validation Design

Each phase has a `### Validation` section with two subsections:
- `#### Automated Verification`: runnable commands (typecheck, tests, lint)
- `#### Manual Verification`: steps requiring human judgment

Not every phase requires manual validation — don't add manual steps just to have them. 
If a phase cannot be manually checked, it may be too small or not vertical enough.
The goal is to catch issues early, not at the end of a 1000+ line change.

Automated testing is always better than manual testing.

## Document Precedence

When documents conflict, the most recent document wins:
**structure outline > design discussion > research > ticket**

The structure outline captures the final phased approach. If the ticket or research
suggested something different, the structure outline reflects the latest decisions.
</guidance>

## Iron Law (per-phase / per-unit test mode — HARD-GATE)

For every behavior-changing unit in the outline, declare exactly one test mode:

- `tdd` — RED before GREEN
- `characterization-then-tdd` — characterize live behavior, then desired-behavior RED → GREEN
- `exempt` — reason + alternative observable check (never silent at implement time)

`implement-outline` enforces RED→GREEN from these declarations. Missing test mode → STOP and ask.


## Git policy (user-owned)

Never run git checkout/commit/push, worktree mutations, or gh pr mutations. Suggest the exact commands for the user to run themselves.

