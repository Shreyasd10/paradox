# Runtime Delegation

The adapter translates a bounded delegation request into the runtime's
task mechanism. It does not create a second workflow body.

## Translation

- Load the canonical agent contract and pass the parent-owned scope, files, test mode, and success condition.
- Dispatch `codebase-locator`, `codebase-analyzer`, and `codebase-pattern-finder` only for bounded research and design-path discovery.
- Dispatch `web-search-researcher` for external docs when needed.
- Dispatch `implementer` only for one coding unit (Iron Law RED→GREEN).
- Optional context agents: `codebase-mapper`, `repo-profiler`, `workspace-locator`.
- Normalize the response to `scope`, `files`, `commands`, `evidence`, and `blockers`.
- Return the normalized result to the parent skill; the parent owns artifact writes, phase transitions, and verdicts.

## Safety

Delegation is read-only with respect to repository history and remote-host
state. A returned user-run action is evidence for a handoff, not an action for
the adapter to execute.
