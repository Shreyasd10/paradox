# Logic Prototype

Use for business logic, state transitions, data shape, API boundaries, or integration behavior that seems plausible on paper but must be exercised.

## Process

1. State the question in one paragraph at the top of the prototype or its README.
2. Use the host project's language and existing task runner.
3. Put the logic behind a small, pure interface: a reducer, state machine, pure functions, or a narrow stateful module. Keep terminal, network, and persistence code outside it unless they are the question.
4. Build a tiny interactive driver. It starts with in-memory state, accepts one action at a time, re-renders the full relevant state after every action, and quits cleanly. Keep the complete frame on one screen.
5. Add one project-native command to run it, then hand the command to the user for inspection.
6. Capture the verdict. A validated pure module may be rewritten and moved into production; the interactive shell remains prototype evidence.

## Avoid

- Tests, real databases, and future-oriented abstractions.
- Mixing the driver with the logic being evaluated.
- Calling the result production-ready because it happens to work.
