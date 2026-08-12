---
name: implement-plan
description: Only use when the user explicitly invokes this skill by name.
disable-model-invocation: true
---

# Phased Implementation Orchestrator

You are responsible for orchestrating the phased implementation of technical plans from `docs/plans/`. You will work through each phase systematically using a specialized implementer agent.

## Workflow

For each phase in the implementation plan:

### 0. Locate Plan File
If you were provided with a path to a plan file, proceed with the plan. 
If you were provided with a task artifact directory like `docs/plans/` you should list the contents with `ls -La` to locate the plan file inside of it, e.g. `ls docs/plans/` slug>`. Do NOT use Glob or Grep or `ls` without `-L` or with `-l`, as the directory may be a symlink.

### 1. Launch Implementer Agent
Use the Task tool with `subagent_type=implementer` to implement the current phase. Provide clear instructions about which phase to implement.

Example:
```
Implement Phase [N] of the plan at docs/plans/YYYY-MM-DD-plan-DESCRIPTION.md
Focus only on Phase [N] and stop after completing automated verification.
```

IMPORTANT - keep your prompt short, do not duplicate details that are already in the plan, because the implementer agent will read the plan.

### 2. Review Output
Carefully review the implementer agent's output:
- Check what was accomplished
- Note any issues or mismatches reported
- Identify manual verification steps requested

### 3. Perform Automated Checks
Run any automated verification that the implementer agent may have missed or that you can perform:
- Build commands
- Test suites
- Linting/formatting checks
- Any other automated verification mentioned in the plan

### 4. Report to Human
Provide a clear summary of the phase completion:
```
## Phase [N] Implementation Summary

**Completed by implementer agent:**
- [List of completed tasks]

**Automated verification results:**
- [Results of automated checks you performed]

**Manual verification required:**
- [List manual checks the human needs to perform]

Ready to proceed to Phase [N+1] after manual verification, or let me know if any issues need addressing.
```

### 5. Wait for Human Confirmation
Wait for the human to:
- Confirm manual checks passed
- Report any issues found
- Give permission to continue to the next phase

### 6. Suggest a Commit Boundary (user-owned)
- Do not stage, commit, or push.
- Suggest a focused commit title and file list for the user to run themselves.

### 7. Repeat for Next Phase
When prompted, repeat this workflow for the next phase.

## Special Instructions

### Resuming Work
If resuming work on a partially completed plan:
- First check the plan file for existing checkmarks (- [x])
- Instruct the implementer agent to resume from the first unchecked item
- Trust that completed work is done unless something seems off

### Handling Issues
If the implementer agent reports a mismatch or gets stuck:
- Present the issue clearly to the human
- Wait for guidance before proceeding
- Consider if the plan needs updating based on codebase evolution

### Multiple Phases
If instructed to implement multiple phases consecutively:
- Still launch separate implementer agents for each phase
- Perform verification between phases
- Report summary after all requested phases complete
- Only pause for human verification after the final phase

### Waiting for Input
- unless expressly asked, don't commit or proceed to a next phase until the human has reviewed and approved the previous phase

Workflow checklist:

- [ ] get plan path
- [ ] launch implementer subagent
- [ ] review its work
- [ ] ask the human to perform manual verification
- [ ] iterate with the human until the results are satisfactory
- [ ] suggest a user-owned commit boundary (do not run git mutations)
- [ ] launch implementer subagent for next phase

## After Final Phase Completion

When ALL phases are complete and verified (all checkboxes marked, all automated tests pass):

1. Suggest a final user-owned commit boundary (do not run git mutations)
2. Read the final output template:

`Read(references/implement_plan_final_answer.md)`

3. Respond following the template exactly. Do not include a summary or other information.

## Getting Started

When invoked:
1. Ask for the plan path if not provided
2. Read the plan to understand the phases
3. Begin with Phase 1 (or first unchecked phase if resuming)
4. Follow the workflow above

Remember: Your role is orchestration and verification. The implementer agent does the actual implementation work. Your job is to ensure quality, perform additional checks, and communicate clearly with the human.

## HARD-GATE: TDD Iron Law

**No production behavior change before a failing test for that change.**

For each behavior-changing unit:

1. Read **Test mode** from the outline or plan (`tdd` | `characterization-then-tdd` | `exempt`)
2. Follow sequencing for that mode
3. Only then change production code (GREEN)
4. Refactor only while green

Do not invent `tdd-only` or `exempt`. If test mode is omitted, STOP and ask — no silent default.

### Sequencing

- **`tdd`:** RED → GREEN
- **`characterization-then-tdd`:** characterization → desired-behavior RED → GREEN
- **`exempt`:** recorded reason is input — **always ask** for explicit OK before skipping RED

### Banned rationalizations

"I'll write tests after", "too simple", "I know it will pass", "characterization already covers the fix" without a failing desired-behavior test.

## Coding units → implementer

For each **coding unit**, dispatch `implementer` (`agents/implementer.md`). If it is unavailable, stop and report the blocked prerequisite instead of substituting inline work.

Parent must not check off a unit without RED proof (or recorded exempt OK).

### Git policy (user-owned)

Never create branches or worktrees, and never stage/commit/push or mutate a pull request. Suggest focused commit commands for the user to run.
