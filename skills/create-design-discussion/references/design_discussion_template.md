[mode overridden: auto -> full, reason=instruction file requires complete content]

---
task: eng-xxxx-description
type: design-discussion
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

Writing: the audience is always a junior developer who is new to this repo and to this topic. They need explaining. One idea per sentence. Every time you use a word they would not know, explain it in that sentence. Do not explain only the first time. If you are unsure whether they know it, they do not. Keep the section names below. Start each section with a takeaway in everyday words, then the specialist facts (paths, commands, schemas).

### Summary of change request

[everyday-words takeaway first, then the specialist summary. Explain every hard word every time you use it.]

### Current State

- [takeaway a first-time reader would notice, in everyday words]
- [what the user sees or experiences today — product behavior, UX gaps, user pain points — no file paths or function names]
- ..
- ..

### Desired End State

- [what will be true when this work is done]
- [user story, problems that will be solved, new things a user can do]
- ..

### What we're not doing

- [things that are out of scope]
- ..

### Proposed End State Architecture

Before:

```mermaid
[one or more diagrams of the before state, logic flow, etc]
```

After:

```mermaid
[one or more diagrams of the before state, logic flow, etc]
```

[concise outline of the proposed end state architecture with description, psuedocode, etc]

### Design Questions

#### [title first question]

[the design question]

- Option A: ...
[optional: short code snippet, mermaid diagram, pseudocode, etc]
- Option B: ...
[optional: short code snippet, mermaid diagram, pseudocode, etc]
- ..

Reccomendation: [....]

#### [title second design question]

...


### Resolved Design Questions

#### [title resolved question]

[option chosen] - [rationale] - [pattern to follow or psuedocode, mermaid diagram, etc]

[brief summary of options not chosen with rationale]


#### [ title second resolved question]

...


### Patterns to follow

These show the patterns found in the existing codebase that will be followed to implement the proposed end state architecture.

#### [title First pattern from research]

[summary of the pattern] - e.g. [path/to/file]

```
[succint code examples from existing codebase demonstrating the pattern]
```

```
[succint code examples from proposed end state architecture demonstrating the pattern]
```

#### [title Second pattern from the research]

...
