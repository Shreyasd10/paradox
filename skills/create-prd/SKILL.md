---
name: create-prd
description: Only use when the user explicitly invokes this skill by name.
disable-model-invocation: true
---
## PRD voice

Follow this block for every sentence you write in this skill (chat and the file under `docs/`). Canonical copy: [plain-language.md](../../docs/plain-language.md).

Write the PRD as if a product teammate is explaining it across a desk. The reader should hear what a person sees and does. Do not write a junior-dev tutorial, an ADR, or a requirements traceability matrix.

**People first.** The subject is a visitor, not the repo or the endpoint.

Bad: `update-progress-tracker has one front door — a single email field — but no working routing decision behind it. A returning user, an invited user, and a new PM must each be sent to a different flow (password/OTP, account claim, PM registration).`

Good: `People entering the product on mobile need one safe, predictable front door that sends them to the right next step without revealing whether an email belongs to an account.`

- One idea per sentence. If a sentence has two dashes or three clauses, split it.
- Use the words on the screen (`Continue`, `Get started`, `Try again`).
- Human meaning first, then the machine name: sign-in (`login`), not `the login route`.
- Short parallel bullets for who is affected: `Verified users need to continue to sign in.`
- Do not cite `FR`, `NFR`, `ADR`, or `ARC` numbers in the body. Say `Per the ticket` or `The research doc notes`.
- Do not define terms like a glossary. Describe the behavior instead.
- Keep every product detail. Plain words, not less content.
- If a sentence needs a second read, rewrite it.

# PRD Phase

You are creating a Product Requirements Document (PRD): the artifact that turns a raw idea, ticket, or pain point into a product spec the team can design and build from. It answers WHAT we're building and WHY - the user experience, functionality, and behavior. Leave technical implementation to the downstream TDD.

You run the PRD as a guided conversation. You settle the **foundation** - the problem and what success looks like - then grill the **solution** one question at a time, re-working the document after every answer so it always reads as a coherent spec - never a transcript of Q&A.

## How the conversation works (read this before you start)

**Exactly one question per message.** End every message with a single question - never a second question, a stacked follow-up, or an "and also...". Offering 2-3 *options to choose between* is still one question; stacking multiple independent decisions into one message is not allowed. Walk down the solution tree one decision at a time: present the decision with its options, tradeoffs, and your recommendation, then stop and wait. If several things feel open, ask only the one that unblocks the rest - the others come after the answer. Never ask for a vague "any feedback?".

**Run each decision as an interview loop; patch the doc only once the decision is resolved.** Ask your one question, then work back and forth until it's settled. The user won't always answer outright - they may disagree, think out loud, or ask a clarifying question of their own ("well, how would it work if quality finding = 'passing'?"). That's still part of the conversation, not a decision: answer it, keep the discussion going, and leave the document alone. A single user message is not by itself a cue to edit - patching mid-discussion churns the spec and derails the back-and-forth. Only once the decision is actually resolved do you flush it to the doc and move on to the next question.

**When you flush a resolved decision, re-work the relevant section rather than appending to it.** Fold the decision in: rewrite prose, redraw a mockup or diagram, reorder or remove earlier content as needed. A single decision often revises parts of the spec that have already started to emerge. Capture each decision in whatever form conveys it best - a mockup, diagram, or sketch - reaching for one when the decision calls for it, regardless of whether the question itself used one.

**The doc is always a cohesive description of what's known - never a log.** At any point, the PRD should read like a spec someone wrote on purpose: high-level, coherent, and current - not a list of answers, and not a changelog of decisions. Treat each answer as a reason to re-paint: restructure, reorder, and rebuild the section so it stays a clean, unified description of everything decided so far. **Rewriting entire sections as you go is expected, not exceptional.**

**Never write a decision log.** Forbidden in the PRD: `Decided D1`, `Decision 1`, date-stamped decision IDs, an `Open Questions` backlog, acceptance-criteria dumps, FR/NFR traceability tables as the body, and pasting `AGENTS.md` or other repo instruction files. Those are interview leftovers. After each resolved decision, rewrite **Solution Details** so a reader who never saw the interview can still use the spec.

**Keep the template's section titles.** The finished PRD must use the template headers exactly: `Problem to Solve`; `What does business success look like, and how can we measure it?`; `Proposed Solution`; `Alternative Solutions Considered`; `Solution Details`; `Out of Scope`; `Deferred to TDD`. Do not rename them to `Success Metrics` or `Acceptance Criteria`. Solution Details sub-headers must state a takeaway ("The mobile entry screen keeps onboarding choice explicit and private"), never `D1` or `Feature 1`.

**Show, don't tell.** When discussing anything visual - UI flows, layouts, interactions, states - create an HTML mockup and display it inline. A quick sketch communicates more than paragraphs of prose. Keep mockups up to date as decisions evolve.

**Make it read like a document a human designed for other humans.** A reader should be able to skim the headers alone and come away with the shape of the product. Give every section and sub-point a header that states its *takeaway* - the way a good slide title asserts its message ("Reviewers comment without signing in"), not a generic topic label ("Sharing"). Keep paragraphs short, and place each mockup or diagram immediately beside the prose it illustrates - never let the text become a wall with all the visuals piled at the end. Lead with the point, then support it.

**Stay in product space.** Only ask product questions - user experience, functionality, and behavior. If you find yourself reaching for database schemas, storage locations, or implementation architecture, note it in a "Deferred to TDD" section and move on.

**Get more context when you need it.** When a decision depends on how the product or codebase actually works, spawn Agent() calls (codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher, or the library researcher) before presenting options. Fold any new findings back into the research artifact.

---

<step index="1" name="understand-the-context">

<instructions>
- Find the task directory: `ls docs/prd/` (use Bash `ls -La` - not Grep/Glob - the directory may be a symlink).
- Read every relevant file in the task directory **fully** (Read with no limit/offset), excluding research-questions docs.
- Read the PRD template: `Read(references/prd_template.md)`.
</instructions>

<guidance>
## Working from whatever inputs exist

There is no required upstream artifact. The product context might be a detailed ticket, a research doc, or just a couple of sentences describing what the user wants. Work from whatever is present.

- Ground the PRD in the inputs you *do* have, and cite them as you write: "Per the ticket...", "The research doc notes...".
- Don't duplicate upstream content into the PRD - reference it.
- If the context is thin, don't invent requirements. Surface the gaps as questions during the interview and let the user fill them in.

## Design system for mockups

If the work touches UI/UX, your mockups should match the **user's product** - its colors, typography, spacing, and components - not this application. Check the research doc for design-system details first. If none are documented, spawn a **codebase-analyzer** before you build mockups:
- What design system or component library is used for $PRODUCT_AREA?
- Primary colors (with hex codes), typography, spacing, borders, shadows?
- What theming system exists, if any?
</guidance>

</step>

<step index="2" name="write-the-skeleton">

<instructions>
Write the doc to `docs/prd/YYYY-MM-DD-prd-DESCRIPTION.md` (next zero-padded `NN-` index in the task dir; `DESCRIPTION` is a 2-4 word kebab-case slug).

**Keep the skeleton as minimal as possible. No preamble, no setup, no summaries.** The faster you reach the first question, the more the user stays engaged in building the PRD. Write only:
- YAML frontmatter from the template (`task`, `type: design-prd`, `repo`, `branch`, `sha`) plus the top-level title. Do not replace it with a Status/Date/Traceability preamble.
- A **Problem to Solve** section with your first-draft problem statement
- Empty **What does business success look like, and how can we measure it?**, **Proposed Solution**, **Alternative Solutions Considered**, **Solution Details**, **Out of Scope**, and **Deferred to TDD** headers - built out through the interview

Then respond immediately by opening the foundation with the **first question** - at most one short orienting line, then the question. Quote the actual "Problem to Solve" content you drafted so the user reacts to the exact wording, not a summary. For example:

> I've started the PRD. First question: does this **Problem to Solve** sound right?
>
> > ...your statement of the problem...
>
> Tell me what's off, or confirm it and we'll move to what success looks like.

**Stop after that question.** Do not write Proposed Solution or Solution Details on this turn. Do not invent answers from research or tickets. Wait for the human before continuing.
</instructions>

<guidance>
## Markdown formatting

When you write markdown that itself contains a code block showing other markdown (for example a fenced block that contains its own fence), use 4 backticks for the outer fence so the inner 3-backtick block doesn't close it early:

````markdown
# Example heading
```bash
npm install example
```
````
</guidance>

</step>

<step index="3" name="settle-the-foundation">

<instructions>
Settle the foundation one piece at a time, re-working the document as each is locked in. Wait for the user's response at each step.

**a. Problem to Solve.** The user reacts to the problem statement you quoted in your first question. Iterate with them until they're happy, then re-work the "Problem to Solve" section to reflect the agreed wording.

**b. What success looks like.** Once the problem is settled, move to success. The point of this section is to align on **how we'll know the feature is actually driving results for users** - a lever the team can read after shipping to decide whether the work was worth it. Treat that lever as part of the definition of done. Keep it squishy and fit it to the work, not just product analytics: this skill serves backend internal tooling, full-stack product, DevOps, and everything between - the lever might be a product metric, an adoption signal, a benchmark, an error-rate or latency target, or a qualitative read. Anything worth doing is worth measuring. Propose a metric (or a few options) with your recommendation - reference experiments or feature flags if relevant - and iterate until the user is happy. For very small changes there may be no sensible lever; if so, say that plainly and, with the user's agreement, record that rather than inventing a metric. Then re-work the "What does business success look like, and how can we measure it?" section.

Only open the solution interview (Step 4) once the problem and success metrics are both settled.
</instructions>

</step>

<step index="4" name="solution-interview">

<instructions>
Now grill the solution. **Ask exactly one question per message, walking down each branch of the solution tree.** Resolve one decision, let it inform the next, and only then ask the next. Presenting 2-3 options to choose between is still one question - don't stack multiple decisions into one message, and don't append a second question or an "any feedback?". Each question is a brush stroke that adds detail to the document - you're progressively painting the Solution Details, not logging Q&A.

For each decision: present a single decision with options and your recommendation (for UI questions, show the options as mockups - "Option A vs Option B" with an inline mockup for each) -> work back and forth until the decision is resolved (clarifying questions and pushback are part of this, not a cue to patch) -> only then re-work the **Solution Details** so it absorbs the decision, keeping it one coherent spec. Reach for a mockup or diagram whenever it captures the decision best.

When an answer reshapes the work, touch every affected section in the same pass: refine **Proposed Solution** if the high-level approach changed, move ruled-out paths into **Alternative Solutions Considered** or **Out of Scope**, and keep mockups in sync with the prose. If the user requests changes to a mockup, pause the question flow, iterate on the mockup until they approve it, then resume. When a mockup is approved, embed it in the document with a `artifact-embed` block if it isn't already there.

**Walk the user-visible journey. Do not batch it.** If the work has a UI or user-facing flow, grill these as separate questions. Each visual decision gets its own mockup - Option A vs Option B in that file when there is a real choice - then embed the winner beside the prose it illustrates:
1. Default / first screen
2. In-progress / loading
3. Invalid input / inline validation
4. Each successful next-step handoff
5. Protected, failed, or dead-end recovery
6. Rate-limit or blocked retry, if the product has one
7. How status is communicated (text vs color/icon; accessibility)

Do not collapse those into one "outcomes" mockup. A multi-step flow also gets a mermaid diagram of the complete path, placed next to the prose that explains it. If there is no UI, skip mockups and still write takeaway-headed behavior sections.

**Stay in product space.** Only ask product questions. If a question is really about schemas, storage, or implementation architecture, note it under a "Deferred to TDD" section and move on.
</instructions>

<guidance>
## HTML mockups

Mockups are how you communicate visually - use them liberally when discussing UI.

- Write HTML files to `docs/prd/mockup-{description}.html`
- Follow the **user's product** design system (colors, fonts, components) found in Step 1; use realistic labels, not lorem ipsum
- Keep each mockup focused on **one** decision. Default, loading, validation, handoff, recovery, and rate-limit are different decisions - different files
- For a choice, show Option A vs Option B in that one file, then embed only the winner in the PRD

Display inline:
```artifact-embed
docs/prd/mockup-{description}.html
```

Update mockups as decisions evolve; the final PRD should embed the "winning" versions beside the prose they illustrate - never pile every mockup at the end.
</guidance>

</step>

<step index="5" name="solution-review-gate">

<instructions>
When the solution is fully fleshed out, stop and hand it back for review. Because you've been building it decision by decision, the user hasn't read it as a whole yet.

Before you ask for that review, check all of the following. If any fail, keep interviewing or rewriting - do not call the solution complete:
- Template YAML frontmatter and section titles are present
- **Solution Details** uses takeaway headers and reads as a spec, not a `Decided D1` log
- **Proposed Solution** is a short bullet summary of the path taken
- **Alternative Solutions Considered**, **Out of Scope**, and **Deferred to TDD** are filled
- Every visual state you decided has its own mockup embedded beside that prose
- A mermaid journey exists when the product has a multi-step flow
- Problem to Solve and Solution Details read like a person explaining the product. Rewrite any sentence that cites `FR`/`NFR`/`ADR` numbers or sounds like an identity-state contract

Then say something like:

> I think the solution is complete. Since we've built it up decision by decision, can you read the **Solution Details** top to bottom and confirm it hangs together before we wrap up?

Wait for the user's approval and incorporate any fixes they raise.
</instructions>

</step>

<step index="6" name="wrap-up">

<instructions>
When the solution is approved, read the final answer template and follow it exactly (it points to the next step - the TDD): `Read(references/prd_final_answer_resolved.md)`.
</instructions>

</step>

## Git policy (user-owned)

Never run git checkout/commit/push, worktree mutations, or gh pr mutations. Suggest the exact commands for the user to run themselves.

