---
name: create-technical-design
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


# Technical Design Phase

You are creating a Technical Design Document (TDD): the artifact that turns whatever product context exists into a technical design the team can build from. It answers HOW we build something - not WHAT or WHY. Leave product requirements and UX to the upstream product context.

You run the design as a guided conversation in **two ordered phases**:

1. **System Design** - how the pieces fit together across components.
2. **Program Design** - how the code inside those pieces is shaped.

You fully settle and get the user's sign-off on the System Design before you open the Program Design. Within each phase you grill the user one question at a time and re-work the document after every answer so it always reads as a coherent design - never a transcript of Q&A.

## How the conversation works (read this before you start)

**Exactly one question per message.** End every message with a single question - never a second question, a stacked follow-up, or an "and also...". Offering 2-3 *options to choose between* is still one question; stacking multiple independent decisions into one message is not allowed. Walk down the decision tree one decision at a time: present the decision with its options, tradeoffs, and your recommendation, then stop and wait. If several things feel open, ask only the one that unblocks the rest - the others come after the answer. Never ask for a vague "any feedback?".

**Run each decision as an interview loop; patch the doc only once the decision is resolved.** Ask your one question, then work back and forth until it's settled. The user won't always answer outright - they may disagree, think out loud, or ask a clarifying question of their own. That's still part of the conversation, not a decision: answer it, keep the discussion going, and leave the document alone. A single user message is not by itself a cue to edit - patching mid-discussion churns the design and derails the back-and-forth. Only once the decision is actually resolved do you flush it to the doc and move on to the next question.

**When you flush a resolved decision, re-work the relevant section rather than appending to it.** Fold the decision in: rewrite prose, redraw a diagram, reorder or remove earlier content as needed. A single decision often revises parts of the section that have already started to emerge - four questions into the program design, the right move may be to restructure two paragraphs you wrote earlier. Capture each decision in whatever form conveys it best - a diagram, signature, or sketch - reaching for one when the decision calls for it, regardless of whether the question itself used one.

**The doc is always a cohesive description of what's known - never a log.** At any point in the conversation, the System Design and Program Design sections should read like a design someone wrote on purpose: high-level, coherent, and current - not a list of answers, and not a changelog of decisions. Treat each answer as a reason to re-paint: restructure, reorder, rebuild, and reorient the section so it stays a clean, unified description of everything decided so far. **Rewriting entire sections as you go is expected, not exceptional.** Favor a smaller, sharper section over an accreting pile of bullet points.

**Show, don't tell.** Reach for a diagram, type signature, or code-shape sketch instead of paragraphs of prose. A quick diagram communicates more than a wall of text. Keep artifacts up to date as decisions evolve.

**Make it read like a document a human designed for other humans.** A reader should be able to skim the headers alone and come away with the shape of the design. Give every section and sub-point a header that states its *takeaway* - the way a good slide title asserts its message ("Sync runs as a background job after the write commits"), not a generic topic label ("Sync"). Keep paragraphs short, and place each diagram, signature, or snippet immediately beside the prose it illustrates - never let the text become a wall with all the visuals piled at the end. Lead with the point, then support it.

**Leverage, not exhaustiveness.** The TDD should let the user decide, align, and re-steer the implementation without loading every detail into their head. Prefer the smallest set of diagrams, signatures, and sketches that reveal the important decisions and tradeoffs.

**Never write a decision log.** Forbidden in the TDD: `Decided D1`, `Decision 1`, date-stamped decision IDs, and appending answers as a changelog. After each resolved decision, rewrite **System Design** or **Program Design** so a reader who never saw the interview can still implement.

**Keep the template's section titles.** The finished TDD must use `System Design`, `Program Design`, `Patterns to Follow`, and optional `What We're Not Doing`. Sub-headers must state a takeaway ("PostgreSQL owns replay state and the audit transaction"), never `D1` or `Persistence`.

**cwd is not the design boundary.** File writes, git, and tools stay in this repository. The TDD may still cover a sibling client or service named by the PRD, ticket, or research. Use documented target architecture when that repo is not checked out. Do not silently drop the client journey because this checkout is the backend.

**Get more context when you need it.** When a decision depends on how the codebase actually works, spawn Agent() calls (codebase-analyzer, codebase-pattern-finder, web-search-researcher, or the library researcher) before presenting options. Fold any new findings back into the research artifact.

---

<step index="1" name="understand-the-context">

<instructions>
- Find the task directory: `ls docs/technical-design/` (use Bash `ls -La` - not Grep/Glob - the directory may be a symlink).
- Read every relevant file in the task directory **fully** (Read with no limit/offset), excluding research-questions docs.
- Read the TDD template: `Read(references/tdd_template.md)`.
</instructions>

<guidance>
## Working from whatever inputs exist

There is no required upstream artifact. The product context might be a full PRD, or just a ticket plus a research doc, or only a couple of sentences describing what the user wants inside an existing research document. Work from whatever is present - **a PRD is not required.**

- Ground the design in the inputs you *do* have, and cite them as you write: "Per the ticket...", "The research doc notes...", "As described in the PRD...".
- Don't duplicate upstream content into the TDD - reference it.
- If the product context is thin, don't invent requirements. Surface the gaps as questions during the interview and let the user fill them in.
- The TDD answers HOW to build what those inputs describe. If a technical decision changes product scope or UX, call it out for the user (and update the PRD/mockups if a PRD exists).
</guidance>

</step>

<step index="2" name="write-the-skeleton">

<instructions>
Write the doc to `docs/technical-design/YYYY-MM-DD-technical-design-DESCRIPTION.md` (next zero-padded `NN-` index in the task dir; `DESCRIPTION` is a 2-4 word kebab-case slug).

**Keep the skeleton as minimal as possible. No preamble, no setup, no summaries.** The faster you reach the first question, the more the user stays engaged in building the TDD. Write only:
- Frontmatter with `type: design-tdd`, plus the top-level title
- Empty **System Design** and **Program Design** headers - built out through the two phases
- **Patterns to Follow** header

Today's reality and the target both get expressed inside the System Design and Program Design during the interview (Steps 3 and 5), so the skeleton itself stays empty.

Then respond immediately by opening the System Design phase with the **first system-design question** - at most one short orienting line, then the question.

**Pick the question that unblocks the rest.** If the PRD, ticket, or research names a sibling repository, a separate mobile/web client, or a contract another repo must consume, the first question MUST be design scope. Do not default to this repository because it is cwd. Name the actual sibling from the inputs.

For example, when the work spans repos:

> I've started the TDD. First system-design decision: should this TDD cover the complete cross-repository journey or only this repository?
>
> - **End-to-end, cross-repository** — designs the sibling client named in the PRD plus the API and infrastructure here; complete story coverage, but some client details rely on documented target architecture rather than checked-out code.
> - **This-repo only** — designs only the API and infrastructure in this checkout; more concrete, but leaves the PRD's executable client journey for a separate TDD.
>
> I recommend end-to-end when the ticket asks to complete the story and the PRD defines both client and backend behavior — which scope should the TDD use?

If the work is clearly one component in this repo, ask the highest-leverage in-repo architecture question instead (inline vs background job, sync vs async).

**Stop after that question.** Do not write System Design or Program Design on this turn. Do not invent answers from research or tickets. Wait for the human before continuing.
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

<step index="3" name="system-design">

<instructions>
Design the cross-component architecture. System Design is about behavior *between* components - how services, endpoints, schemas, queues, stores, and external systems interact - not the code inside any one of them.

Convey **how the system changes**: what exists today and what's new or different. Express the delta so the reader understands the change at a glance.

**Ask exactly one question per message, walking down each branch of the design tree.** Resolve one decision, let it inform the next, and only then ask the next. Presenting 2-3 options to choose between is still one question - don't stack multiple decisions into one message, and don't append a second question or an "any feedback?".

For each decision: present a single decision with options (as diagrams / signatures / endpoint shapes when that's the clearest form) and your recommendation -> work back and forth until the decision is resolved (clarifying questions and pushback are part of this, not a cue to patch) -> only then re-work the **System Design** section so it absorbs the decision, keeping it one coherent architecture. Reach for a diagram, signature, or sketch whenever it captures the decision best.

**Walk the architecture. Do not batch it.** Grill these as separate questions when they apply. Do not collapse them into one backend dump:

1. Design scope / repo boundary (this-repo vs end-to-end)
2. How contracts cross that boundary (published OpenAPI artifact, versioning, CI consume) when a sibling client exists
3. Persistence as real `CREATE TABLE` (or the project's Flyway/Liquibase/ORM form) — not a table sketch in prose
4. Operational vs immutable store lifecycles (retention, cleanup, what a replay must not duplicate)
5. Fails-closed pipeline order: what runs first, and what happens if Redis, the database, identity, or the transaction is unavailable — including no partial record
6. Idempotency, concurrency, and the HTTP status for key reuse with a different fingerprint (prefer `409 Conflict` over `400` for that resource conflict)
7. Client-facing contract details the PRD already settled: required headers, `Retry-After` scoping, handoff data minimization, client-only forks that must not call the API
8. Timing or padding if the PRD requires it

When a hash is stored for lookup of a secret-ish identifier such as email, recommend HMAC with a server secret rather than an unspecified hash.

Use the representations in the guidance below; pick the form that makes each decision clearest.
</instructions>

<guidance>
## System Design representations

**Mermaid diagrams** for control flow, data flow, and component interactions:
```mermaid
sequenceDiagram
    participant Client
    participant Service
    participant Store
    Client->>Service: request
    Service->>Store: read/write
    Store-->>Service: result
    Service-->>Client: response
```

**High-level type signatures** for the contracts that define the boundary (use the codebase's language):
```
createResource(input: CreateResourceInput) -> Resource
```

**Endpoint / message shapes** for the interfaces between components - routes, message definitions, or request/response schemas in whatever transport the codebase uses (REST, RPC such as gRPC, GraphQL, queue events, etc.):
```text
PUT /api/resources/:slug
  request:  { destination: string }
  response: { resource: Resource }
```

**Data contracts** when a schema is part of the cross-component agreement:
```sql
CREATE TABLE artifact_sync_status (
  artifact_id   UUID PRIMARY KEY REFERENCES artifacts(id),
  content_hash  TEXT NOT NULL,
  cloud_permalink TEXT
);
```
If the codebase uses an ORM or a schema-definition library, the equivalent ORM-specific definition may be clearer than raw SQL - use whatever form matches the project. If you catch yourself writing a table sketch in prose (`auth_route_replay` followed by field names), replace it with `CREATE TABLE` or the project's migration form. Name the migration tool when the repo has one (Flyway, Liquibase, Prisma, and so on).

## HTML artifacts for complex concepts

When a concept is too complex for Mermaid or plain text - combining data flow, structure, annotations, or side-by-side comparisons - write a focused HTML artifact and display it inline:
- Write to `docs/technical-design/diagram-{description}.html`
- Keep each artifact focused on the decision at hand; use realistic labels, not lorem ipsum
```artifact-embed
docs/technical-design/diagram-{description}.html
```

**If you are writing an HTML artifact, read `references/artifact_template.html` and follow it.** Copy its `<style>` block and build your content in the body using its prose elements and utility classes (`.card`, `.badge*`, `.stat*`, `.ba`). The artifact must follow the template so it matches the artifact template, not the codebase the TDD is about.
</guidance>

</step>

<step index="4" name="system-design-review-gate">

<instructions>
When the cross-component architecture is settled, stop and hand it back for review. Because you've been fleshing it out section-by-section, the user hasn't read it as a whole yet.

Before you ask for that review, check all of the following. If any fail, keep interviewing or rewriting - do not call the system design complete:
- Template YAML frontmatter and section titles are present
- **System Design** uses takeaway headers and reads as a design, not a `Decided D1` log
- Repo / client boundary is stated, including sibling repositories the PRD named even when they are not cwd
- Persistence uses real `CREATE TABLE` or the project's migration/ORM form, not a table sketch
- Operational vs immutable store lifecycles (retention, cleanup) are separated
- Fails-closed pipeline order is explicit, with mermaid or ordered steps
- Idempotency conflict uses `409 Conflict` unless the human chose otherwise
- Client-facing contract details from the PRD are present when the work has a client journey: required headers, `Retry-After` scoping, handoff data minimization, client-only forks
- **Program Design** is still empty — that phase has not started

Then say something like:

> I think the system design is complete. Since we've been building it up decision by decision, can you read the **System Design** section top to bottom and confirm it hangs together before we move on to program design?

Wait for the user's approval. Incorporate any fixes they raise. **Do not open the Program Design phase until the user signs off on the System Design.**
</instructions>

</step>

<step index="5" name="program-design">

<instructions>
Now design the in-code shape under the **Program Design** header.

**Ask exactly one question per message, walking down each branch of the design tree.** Same rhythm as system design: resolve one decision, let it inform the next, re-work the section after each answer. Presenting 2-3 options to choose between is still one question - don't stack multiple decisions into one message, and don't append a second question or an "any feedback?".

**Almost every message should carry a code block.** Program design is a discussion about the shape of code, so visualize it richly rather than describing it in prose: show each option as a concrete code-shape sketch - a `diff`, a call-stack tree, a file-tree diff, a component tree, a type signature, or pseudocode (use the views in the guidance below). When you present 2-3 options, render each one as its own code block so the user compares the actual shapes side by side, not your description of them. A message that asks a program-design question with no code block should be the rare exception - if you catch yourself explaining a code change in words alone, convert it into one of the views before sending.

For each decision: present a single decision with options as concrete code-shape sketches and your recommendation -> work back and forth until the decision is resolved (clarifying questions and pushback are part of this, not a cue to patch) -> only then re-work the **Program Design** section so it absorbs the decision, keeping it one coherent description of the code shape. A resolved decision often updates the call tree, file shape, or testing seams you already started, so restructure and redraw those in place.

Use the views in the guidance below that fit the change.
</instructions>

<guidance>
## Program Design views

Be concrete but selective - include the views that clarify the design.

**Call-stack tree** - for services, CLIs, workers, or any orchestration / control-flow change. Show the important calls, not every frame.
```text
entrypoint
  runCommand
    handleCreateResource
      ResourceClient.create(input)
        POST /resources
      renderResult
```
Use `diff` syntax only when it highlights changed/added/removed calls; if most of the snippet is net-new, plain `text` is clearer.
```diff
 entrypoint
   runCommand
+    handleCreateResource
-    legacyCreateFlow
```

**Frontend component tree** - UI changes. Show production components, their state/local data, and module/package boundaries (the example below is React/TSX - adapt to whatever UI framework the codebase uses).
```tsx
<ResourcePage> (apps/example/src/routes/resource.tsx)
  useResourceActions()
  <ResourceToolbar>
    <CreateResourceDialog> (packages/ui)
      useFormState()
```
Use `diff` syntax only when it highlights changed/added/removed components, props, or state.
```diff
 <ResourcePage> (apps/example/src/routes/resource.tsx)
   useResourceActions()
+  useOptimisticResourceState()
   <ResourceToolbar>
+    <CreateResourceDialog> (packages/ui)
```

**File-tree diff** - broad refactors or when file responsibility is a design decision. Format like `tree` output so depth is easy to scan; keep it high-level.
```diff
 src
 └── resource
+    ├── resource-client.ext      # NEW - wraps API contract calls
+    ├── resource-client.test.ext # NEW - covers request/response mapping
~    └── resource-route.ext       # MODIFIED - wires create action into UI
```

**Dependency-injection map** - the seams and injected dependencies that matter, grouped by the object/workflow that receives them. Explain what each dependency lets the code do or fake in tests; avoid raw constructor dumps.
```text
createResourceWorkflow
  receives resourceStore    -> persists resources, fakeable in workflow tests
  receives eventPublisher   -> emits resource-created events after commit
  receives clock            -> makes timestamps deterministic

ResourcePage
  receives createResource   -> UI does not know transport details
  receives queryClient      -> updates cached resource list after success
```

**Testing seam map** - the few seams that prove the risky parts are testable. Connect behavior to the fake/mock boundary and the test location.
```text
Behavior                          Seam / fake                  Test location
rejects invalid resource input    fake resourceStore unused    resource-workflow.test
rolls back publish failure        fake eventPublisher throws   resource-workflow.test
shows optimistic row              fake createResource promise  ResourcePage.test
maps interface validation errors  mocked transport response    resource-client.test
```

**Internal method signatures** for key new functions not captured in system design (use the codebase's language):
```
resolveTarget(items: Item[], cursor: Cursor) -> ItemId | null
```

**Pseudocode** for complex algorithms or logic - english-y, not a programming language:
```text
on(artifactSave)
  if artifact.unchanged(oldHash)
    return cached permalink
  else
    objectStore.upload(artifact.content)
    update local cache with new hash and permalink
    return fresh permalink
```

## HTML artifacts for complex concepts

The same HTML-artifact escape hatch from the System Design step applies here - use a focused inline HTML artifact when code shape, data flow, and annotations are clearer together than in plain text. Base any HTML artifact on `references/artifact_template.html` so it matches the artifact template visual language.
</guidance>

</step>

<step index="6" name="program-design-review-gate">

<instructions>
When the program design is settled, hand it back for review the same way.

Before you ask for that review, check all of the following. If any fail, keep interviewing or rewriting:
- **Program Design** uses takeaway headers and is not empty
- At least one call-stack tree, file-tree diff, or component tree is present
- A dependency-injection map or testing-seam map shows how the risky parts are faked
- **Patterns to Follow** names existing files in this repo (or the designed sibling) with a short snippet

Then say something like:

> I think the program design is complete too. Can you review the **Program Design** section and confirm the code shape and testing seams look right?

Wait for the user's approval and incorporate any fixes.
</instructions>

</step>

<step index="7" name="wrap-up">

<instructions>
When both phases are approved, read the final answer template and follow it exactly (it points to the next step - the structure outline): `Read(references/tdd_final_answer_resolved.md)`.
</instructions>

</step>

## Git policy (user-owned)

Never run git checkout/commit/push, worktree mutations, or gh pr mutations. Suggest the exact commands for the user to run themselves.

