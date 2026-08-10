---
name: wayfinder
description: "Map multi-session uncertainty as decision tickets, using bounded prototypes when code is needed to learn. User-invoked only; planning and evidence-gathering, not feature delivery."
disable-model-invocation: true
---

# Wayfinder

A loose idea has arrived, too big for one agent session and wrapped in fog: the way from here to the **destination** is not visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repository's issue tracker, then works its decision tickets one at a time until the route is clear. A ticket may resolve through discussion, research, or a bounded code prototype when the architecture cannot be understood honestly without implementation.

The destination varies per effort, and naming it is the first act of charting because it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place such as a data-structure migration. The map is domain-agnostic.

## Place in this workflow

Use Wayfinder before the normal planning spine when the effort is too large or uncertain for one session:

```text
wayfinder ↔ prototype → brainstorm → create-plan → implement-plan → validate → compound
```

Wayfinder clears distributed uncertainty. Once the map is complete, hand its linked decisions and prototype evidence to `create-design-discussion` for design consolidation and approval, then continue to `create-plan`. Do not use Wayfinder for work already clear enough to fit in one `create-design-discussion`, `create-research`, or `create-plan` session.

## Map to learn, not to specify everything

Wayfinder is planning and evidence-gathering by default. Most tickets resolve a decision, but a **Prototype** ticket is the right tool when the decision depends on seeing real behavior, state transitions, integration boundaries, or a thin vertical slice in code. Do not force those questions into prose first.

A prototype has one explicit question, the smallest runnable experiment that can answer it, and an observable verdict. Iterate inside that ticket: implement, inspect, refactor the experiment, and reassess the map. The implementation is evidence, not feature delivery; keep the validated decision or portable logic only when it earns its way into the real code. Production delivery still follows `create-plan` and `implement-plan`.

Keep the map low-fidelity. Its closed-ticket gist is a short verdict plus a link to the prototype or branch, never a retelling of the experiment. The map is done when the route is clear enough to plan, not when every architectural uncertainty has been predicted in documents.

## Refer by name

Every map and ticket has a **name**, its title. In everything the human reads, including narration and the map's Decisions so far, refer to it by that name, never by a bare id, number, or slug. Keep the id and URL inside the linked name.

## Tracker adapter

Use the tracker named by the user or repository configuration. Prefer the repository host's native issue tracker and tools. For GitHub repositories, use GitHub issues, sub-issues or task-list relationships, labels, assignees, and native blocking relationships when available.

Before the first shared-state write, show the proposed map and initial ticket titles and obtain confirmation unless the invocation already explicitly authorized creating tracker issues.

If no tracker is configured or accessible, use a local Markdown tracker:

```text
docs/wayfinder/<map-slug>/map.md
docs/wayfinder/<map-slug>/tickets/<ticket-slug>.md
```

In local mode:

- Map and ticket filenames are their identities and relative links are their URLs.
- Ticket frontmatter records `status`, `type`, `assignee`, and `blocked_by`.
- An open ticket with no assignee is unclaimed.
- A ticket is unblocked when every entry in `blocked_by` is closed.
- The frontier is the ordered set of open, unblocked, unclaimed tickets.
- Claim by setting `assignee` before doing any work.

Never silently switch trackers after a map has been created.

## The map

The map is a single issue labelled `wayfinder:map`, or `map.md` in local mode. It is the canonical artifact, and its tickets are child issues or linked local ticket files.

The map is an **index**, not a store. It lists decisions made and points at the tickets holding their detail. A decision lives in exactly one place, its ticket, so the map only gists and links it.

### Map body

Load this low-resolution view once per session. Do not list open tickets in the body because the tracker frontier query or local ticket files provide them.

```markdown
## Destination

<What reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines.>

## Notes

<Domain, skills every session should consult, tracker mode, and standing preferences for this effort.>

## Decisions so far

<!-- One line per closed ticket: enough to judge relevance, then follow the link for detail. -->

- `<closed ticket title>` (tracker URL): <one-line gist of the answer>

## Not yet specified

<!-- In-scope fog that cannot be stated precisely enough to ticket yet. -->

## Out of scope

<!-- Work ruled beyond the destination. Closed and never graduated. -->
```

### Tickets

Each ticket is a child issue of the map or a linked local ticket file. Its body starts with:

```markdown
## Question

<The decision or investigation this ticket resolves>
```

Each ticket carries one `wayfinder:<type>` label or local `type`: `create-research`, `prototype`, `grilling`, or `task`.

A session **claims** a ticket by assigning it to the developer driving the map before any work. The assignee is the claim; open and unassigned means unclaimed. Concurrent sessions must skip claimed tickets.

Blocking uses the tracker's native dependency relationship whenever possible so the frontier is visible in the tracker UI. Only trackers without native blocking fall back to metadata or a body convention. A ticket is **unblocked** when every blocking ticket is closed. The **frontier** is the open, unblocked, unclaimed children, the edge of the known.

Record the answer on resolution, not in the original question. Link assets created while resolving a ticket rather than pasting large artifacts into the issue.

## Ticket types

Every ticket is either **HITL**, worked with a human who speaks for themselves, or **AFK**, driven by the agent alone. A HITL ticket resolves only through that live exchange. Never answer the human's side on their behalf.

- **Research** (AFK): Read documentation, third-party APIs, or local resources to surface a fact that a decision awaits. Resolve through the `create-research` skill or a focused research subagent. Link the resulting `docs/research/` artifact from the ticket. Use when knowledge outside the current working context is required.
- **Prototype** (HITL or AFK): Build the smallest runnable, disposable or production-adjacent experiment that answers one design or architectural question. Use the `prototype` skill and link its code or throwaway branch. Use when behavior, state, integration boundaries, or UI cannot be judged reliably from prose. Record the question, observed verdict, and what (if anything) is safe to carry into production.
- **Grilling** (HITL): Conduct a conversation through `grilling` and `domain-modeling`, one question at a time. This is the default.
- **Task** (HITL or AFK): Complete manual work required before a decision can be made. It does rather than decides, and belongs only when it unblocks a decision rather than delivers the destination. The agent drives it alone when possible; otherwise give the human a precise checklist. Record what was done and any facts later tickets depend on.

## Fog of war

The map is deliberately incomplete. Do not chart what cannot yet be seen. Beyond live tickets lies the **fog of war**, decisions and investigations that are likely to arise but cannot yet be pinned down because they depend on open questions.

Write this dim view under **Not yet specified**. It is in scope but not sharp enough to ticket. Resolving a ticket clears the fog ahead, graduating newly specifiable questions into tickets one at a time until the destination is clear and no tickets remain.

The test is whether the question can be stated precisely now, not whether it can be answered now:

- **Ticket it** when the question is already sharp, even if blocked.
- **Leave it in Not yet specified** when the question cannot yet be phrased precisely.

Do not pre-slice fog. A fog patch may later become several tickets or none. Exclude anything already decided, already ticketed, or out of scope.

## Out of scope

Fog gathers only toward the destination. Work beyond it belongs under **Out of scope**, never under **Not yet specified**.

Out-of-scope work never graduates unless the destination itself is redrawn, in which case create a fresh effort. If an existing ticket proves to be beyond the destination, close it and add one linked line under **Out of scope** with the gist and reason. Do not add it to **Decisions so far**, which records the route actually walked.

## Invocation

This skill is user-invoked and has two modes. In either mode, never resolve more than one ticket per session, except for parallel research tickets. A single Prototype ticket may contain its own tight implement–inspect–refactor loop until its question has a verdict.

### Chart the map

The user invokes `wayfinder` with a loose idea.

1. **Name the destination.** Run `grilling` and `domain-modeling` to pin down the spec, decision, or change this map is finding its way to. The destination fixes scope, so settle it first.
2. **Map the frontier.** Grill again, breadth-first: fan across the whole space instead of going deep on one thread. Surface open decisions, identify which questions require code evidence, and find the first steps takeable now. If no fog appears and the journey fits one session, do not create a map. Explain that Wayfinder is unnecessary and route to `create-design-discussion`, `create-research`, `prototype`, or `create-plan`.
3. **Draft the map and initial ticket set.** Fill Destination and Notes, leave Decisions so far empty, and sketch the fog under Not yet specified.
4. **Create the map** with `wayfinder:map`, then create every ticket precise enough to state now as a child. Create first, wire blocking relationships in a second pass because tickets need identities before they can reference one another.
5. **Fire research subagents.** For each initial research ticket, launch a focused `create-research` subagent in parallel. Each result writes or updates a `docs/research/` artifact, posts its resolution to the ticket, closes it, and adds its context pointer to Decisions so far. Do not start Prototype tickets while charting unless the user explicitly asked to resolve one now.
6. Stop. Charting is one session's work and hand-resolves no non-research ticket.

### Work through the map

The user invokes `wayfinder` with a map URL, issue number, or local map path. A ticket is optional; without one, choose the next decision.

1. Load the **map**, the low-resolution view, not every ticket body.
2. Query the frontier. If the user named a ticket, use it if eligible. Otherwise take the first frontier ticket in tracker order.
3. **Claim it** before any work by assigning it to the current developer or setting the local assignee.
4. Resolve it. Zoom into related or closed tickets only as needed and invoke every skill named in Notes. Use `prototype` for questions that need code evidence; use `grilling` and `domain-modeling` when in doubt.
5. Record the resolution: post the answer as a resolution comment or local Resolution section, close the ticket, and append one linked gist to Decisions so far. For a Prototype, record only its question, verdict, and artifact link; do not duplicate the prototype's details in the map.
6. Create newly surfaced tickets, then wire their dependencies. Graduate fog made specifiable and remove each graduated patch from Not yet specified so it lives only in its ticket.
7. If a ticket lies beyond the destination, rule it out of scope. If a decision invalidates other map areas, update or close those tickets.
8. When no open tickets or in-scope fog remain, mark the map complete and hand its URL or path to `create-design-discussion`. After the brainstorm artifact is approved, continue to `create-plan`.

Expect concurrent tracker edits. Refresh map, ticket, claim, and blocking state immediately before every mutation.

## Verify the session

Before stopping:

- The map still states a clear destination.
- Every open ticket has exactly one type and a precise question.
- Claims and blockers match current tracker state.
- Each closed route ticket has one linked gist under Decisions so far.
- Graduated fog exists only as tickets.
- Out-of-scope tickets are closed and absent from Decisions so far.
- Any code written outside a bounded Prototype ticket was explicitly authorized in Notes.
- Each closed Prototype ticket links to its code evidence and states a short verdict.
