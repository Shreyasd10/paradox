---
task: eng-xxxx-description
type: design-prd
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [PRD Title]

### Problem to Solve

[What problem are we solving? What user pain point or business need does this address?]

- [What the user sees or experiences today]
- [Current product behavior, UX gaps, user pain points]
- [No file paths or function names - focus on user experience]
- ..

[if appropriate, mermaid diagram of logic flow or user workflow or business process that demonstrates the "Problem to Solve"]


### What does business success look like, and how can we measure it?

- [What will be true when this work is done]
- [User story, problems that will be solved, new things a user can do]
- [How will we know this is successful?]
- [Measurable outcomes or user behaviors we expect to see]
- [references to experiments or feature flag system if relevant]

### Proposed Solution

[leave blank to start, fill out with high-level bullet-points of the proposed solution and any relevant diagrams / mockups]

- [path taken] - [rationale]
- ...

### Alternative Solutions Considered

[leave blank to start, fill out with high-level bullet-points of the paths not taken w/ rationale]

- [path not taken] - [rationale]
- ...

### Solution Details

[Rewrite this as a cohesive spec after every decision - never a `Decided D1` log. Embed each mockup beside the prose it illustrates.]

#### [Takeaway header that states the point, not a topic label]

[Description of this feature]

[if appropriate, mermaid diagram of the complete user journey]

[if appropriate, inline html mockup - one visual state per file]
```artifact-embed
docs/prd/mockup-{description}.html
```

[Explanation of mockup and any behavioral notes]

#### [Next takeaway header]

..

### Out of Scope

[leave blank to start, fill out with high-level bullet-points of the paths not taken w/ rationale]

- [Things that are explicitly out of scope]
- [Features or behaviors we're intentionally not building]
- ..

### Deferred to TDD

- [Implementation details that are not product decisions: schemas, storage, API generation, client navigation internals]
- ..
