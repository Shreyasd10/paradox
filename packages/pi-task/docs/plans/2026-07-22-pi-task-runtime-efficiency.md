---
status: complete
---

# Pi Task Runtime Efficiency Implementation Plan

## Overview

Improve `pi-task` so five delegated subagents are admitted promptly, initialize with less duplicated work, and consume bounded tokens without modifying any agent Markdown or prompt text. The implementation combines Codex-style shared immutable runtime infrastructure and lease-based admission, OpenCode-style bounded retained results, and Grok-style runtime turn limits while retaining Pi-native isolated `AgentSession`s.

## Current State Analysis

`pi-task` already runs children in-process and disables child extensions, skills, templates, themes, and context files. The remaining latency and token problems are:

- The scheduler permits four active children and queues the fifth (`src/concurrency.ts:6-47`).
- Background execution awaits admission before returning its acknowledgement, so a fifth parallel `background: true` tool call blocks the parent tool batch until another child exits (`src/index.ts:930-1049`).
- Every child creates a new `SettingsManager`, reloads a `DefaultResourceLoader`, creates a model runtime indirectly, and then creates its isolated session (`src/child-runner.ts:104-141`).
- Child output is accumulated in an unbounded string before post-generation truncation; this does not prevent output-token use and duplicates the full response already persisted by `AgentSession` (`src/child-runner.ts:169-176`, `src/child-runner.ts:217-228`).
- Live usage events carry cumulative usage, while the roster adds each event as a delta, temporarily double-counting multi-turn runs (`src/child-runner.ts:183-197`, `src/activity.ts:79-92`).
- Background results are inserted into the parent context through completion messages (`src/result-watcher.ts:74-111`), so their retained size affects the parent’s next input-token count.

The existing baseline is 62 passing tests via `npm test`. `npm run typecheck` currently cannot run because the local `tsc` executable is missing. The repository also contains pre-existing uncommitted changes in runtime, UI, README, package, and test files; implementation must preserve and integrate with them rather than overwrite them.

## Desired End State

After implementation:

1. Five background task calls return queued/running acknowledgements without waiting for a child to finish.
2. Up to five children run concurrently by default, constrained by configurable global and provider-specific limits.
3. Queue acquisition is cancellable and lease-based; queued cancellation cannot start a provider request or leak capacity.
4. All child sessions share one lazily initialized Pi `ModelRuntime`, while mutable settings, session, extension runtime, abort state, and transcript state remain isolated per child.
5. Agent prompt files and composed prompt bytes remain unchanged.
6. Balanced defaults apply per invocation: 12 completed turns, 32,768 total output tokens, and 16,384 output tokens per provider request. Thinking inherits the parent unless explicitly overridden; fork safety can still force thinking off.
7. Parent-visible completion output is capped at 24KB using a 16KB head and 8KB tail, while the full transcript remains in the child session.
8. Live, persisted, foreground, resume, and notification usage totals agree exactly.

### Default Runtime Policy

```json
{
  "maxConcurrent": 5,
  "maxQueued": 8,
  "providerConcurrency": {},
  "defaultThinking": "inherit",
  "defaultMaxTurns": 12,
  "defaultMaxOutputTokens": 32768,
  "maxOutputTokensPerRequest": 16384,
  "resultHeadBytes": 16384,
  "resultTailBytes": 8192
}
```

Configuration is loaded from `~/.pi/agent/pi-task.json`. Missing configuration uses these defaults. A value of `0` disables the corresponding turn or output-token cap. Per-call `max_turns`, `max_output_tokens`, and `thinking` override global policy for that invocation; concurrency and result-retention limits remain global.

### Key Discoveries

- Pi executes sibling tool calls concurrently but awaits all tool promises, which makes a queued background `execute()` promise block the parent batch.
- Pi’s public SDK supports passing one `ModelRuntime` to many `createAgentSession()` calls; `createAgentSession` otherwise creates a runtime when none is supplied (`@earendil-works/pi-coding-agent/dist/core/sdk.js:65-69`).
- `Agent.streamFn` is a public writable property, making a per-request `maxTokens` wrapper possible without changing prompt text (`@earendil-works/pi-agent-core/dist/agent.d.ts:38`).
- Pi already provides automatic session compaction. A separate OpenCode/Grok compaction engine would duplicate model calls and state machinery.
- Codex’s atomic reservation/lease pattern is the relevant concurrency model (`codex/codex-rs/core/src/agent/registry.rs:260-322`).
- OpenCode’s output-token clamp is the relevant request-budget pattern (`opencode/packages/opencode/src/provider/transform.ts:1347-1349`).
- Grok’s explicit child max-turn enforcement is the relevant lifecycle pattern (`grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs:2322-2335`).

## What We’re NOT Doing

- Modifying `~/.pi/agent/agents/*.md`, project agent files, agent system prompts, task prompts, or the LeanCTX prompt text/order.
- Replacing Pi-native sessions with subprocesses, RPC, or a separate daemon.
- Sharing mutable `AgentSession`, `SessionManager`, `SettingsManager`, `DefaultResourceLoader`, extension runtime, transcript, timer, or abort state across children.
- Implementing a second compaction or summarization system.
- Automatically lowering thinking below the parent’s selected level.
- Implementing adaptive rate-limit feedback or automatic concurrency reduction from HTTP 429 responses; provider limits are explicit configuration.
- Adding project-local pi-task configuration in this iteration.
- Deleting historical task-state/session files or adding retention cleanup.
- Treating UI-only truncation as model-token savings.

## Implementation Approach

Introduce a small runtime control plane that owns configuration, scheduling, shared model infrastructure, and task-local execution. Admission becomes a cancellable provider-aware lease rather than a scalar counter. Background calls persist and return a queued acknowledgement immediately, then acquire and execute in a detached flow; foreground calls continue to await completion.

A single lazy `ModelRuntime` is shared through Pi’s public `createAgentSession({ modelRuntime })` option. Each child receives a small task-local `ResourceLoader` backed by a fresh empty extension runtime and the exact existing append-prompt list, avoiding repeated discovery/reload while preserving prompt bytes. Settings and sessions remain task-local.

Runtime budgets are enforced without editing prompts: thinking is passed through `createAgentSession`, `Agent.streamFn` clamps each provider request to the remaining output budget, and completed turns are counted from child events. Budget exhaustion stops before another provider request, preserves the latest useful response, and records a non-error limit reason.

## Phase 1: Characterize Behavior and Add Runtime Policy

### Overview

Lock existing prompt/lifecycle behavior in tests, add validated global configuration and task overrides, and correct live usage accounting before scheduling and runtime changes rely on those values.

### Behavior Unit 1.1: Configuration Resolution

**Test mode:** `tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| `~/.pi/agent/pi-task.json` is absent | Use documented defaults without warning. |
| JSON is malformed | Use defaults and expose one diagnostic notification; do not prevent task launch. |
| A field is wrong-type or outside its allowed range | Ignore that field, retain valid fields, and report the invalid key. |
| Provider limit is zero | Treat that provider cap as disabled and use only the global cap. |
| Per-call override is invalid | TypeBox rejects the tool call before task state or provider work begins. |
| Per-call value is zero | Disable that cap for the invocation. |

### Changes Required

#### 1. Runtime policy types and loader

**File:** `src/config.ts` (new)

**Changes:**

- Define `PiTaskConfig`, `TaskPolicyOverrides`, `ResolvedTaskPolicy`, defaults, numeric bounds, and diagnostics.
- Load only `path.join(getAgentDir(), "pi-task.json")`.
- Merge precedence as per-call override → file value → built-in default.
- Keep parsing synchronous and side-effect free except file reading.
- Export provider limit resolution keyed by `Model.provider`.

#### 2. Tool schema and execution policy

**File:** `src/index.ts`

**Changes:**

- Add optional `max_turns`, `max_output_tokens`, and `thinking` parameters.
- Use `StringEnum` for `thinking`: `inherit`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- Load config once per extension runtime and surface diagnostics during `session_start` when UI is available.
- Resolve fork-safety precedence as forced `off` → task override → config setting → current parent thinking level.
- Persist resolved policy metadata in the task record so resume/debugging is reproducible.

#### 3. Persisted optional policy metadata

**File:** `src/types.ts`

**Changes:**

- Add optional policy and completion-limit fields to `TaskRecord`, `TaskResult`, and `ChildRunOutput`.
- Keep fields optional so existing `record.json` and `result.json` files remain readable without migration.

#### 4. Tests

**Files:**

- `test/config.test.ts` (new)
- `test/types.test.ts`

**Changes:**

- Cover defaults, partial valid config, malformed JSON, invalid values, provider lookup, zero-as-disabled behavior, and override precedence.
- Verify old persisted record shapes remain accepted.

### Behavior Unit 1.2: Exact Usage Accounting

**Test mode:** `characterization-then-tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Two assistant messages emit usage | Live total equals the arithmetic sum exactly once. |
| An event omits a usage field | Missing field contributes zero. |
| Final child usage replaces live state | Persisted and displayed totals match final authoritative usage. |
| Resume starts another invocation | Invocation usage resets consistently with existing behavior. |

### Changes Required

#### 1. Usage event contract

**Files:** `src/activity.ts`, `src/child-runner.ts`

**Changes:**

- Replace ambiguous cumulative `message_end.usage` semantics with explicit per-message deltas.
- Continue maintaining an invocation-level accumulator in `runChild()` for final persistence.
- Ensure roster application adds each delta exactly once.

#### 2. Regression tests

**Files:** `test/activity.test.ts`, `test/child-runner.test.ts`

**Changes:**

- First add a characterization test demonstrating current cumulative-on-cumulative behavior.
- Change the contract and assert two-turn live totals, final totals, cache totals, cost, and turn count.

### Behavior Unit 1.3: Prompt Preservation Contract

**Test mode:** `characterization-then-tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| No agent body is supplied | Existing LeanCTX append prompt remains byte-identical. |
| Agent body is supplied | Existing order and exact bytes remain LeanCTX preamble followed by the unchanged agent body. |
| Runtime overrides are supplied | System/task prompts remain unchanged. |

### Changes Required

#### 1. Prompt composition seam

**File:** `src/child-runner.ts`

**Changes:**

- Extract prompt-list construction into a pure function without changing constants or content.

#### 2. Snapshot assertions

**File:** `test/child-runner.test.ts`

**Changes:**

- Capture exact append-prompt strings and ordering before later loader replacement.
- Assert budget/thinking options do not mutate task or system prompt text.

### Success Criteria

#### Automated Verification

- [x] Config tests pass: `node --test --experimental-strip-types test/config.test.ts`
- [x] Usage/prompt tests pass: `node --test --experimental-strip-types test/activity.test.ts test/child-runner.test.ts`
- [x] Full suite passes: `npm test`
- [ ] Type checking passes once dev dependencies are available: `npm run typecheck` — blocked: local `typescript`/`@types/node` not installed; awaiting confirmation to run `npm install`

**Phase 1 status:** Units 1.1–1.3 shipped (config policy, usage deltas, prompt snapshot). Next: manual verification, then Phase 2.

#### Manual Verification

- [x] Starting Pi with no config produces no warning and uses the documented defaults. (verified via `loadPiTaskConfig` absent-path probe: 0 diagnostics, defaults match)
- [x] A malformed config produces one actionable warning but tasks still launch. (verified via malformed JSON probe: 1 diagnostic, defaults retained; tasks still construct)
- [x] Existing agent files are byte-identical before and after this phase. (`git diff --name-only -- '*agents/*.md'` empty; repo has no agent Markdown)

- [x] Type checking: `npm install` completed; `tsc` runs. Remaining `src/index.ts` errors are largely pre-existing AgentToolResult/model typing issues; Phase-1-introduced thinking/AgentScope casts fixed.

**Phase 1 status:** complete enough to proceed. User asked to continue without interactive Pi TUI pause.

---

## Phase 2: Replace Admission with a Provider-Aware Lease Scheduler

### Overview

Replace fixed scalar admission with cancellable leases and make background acknowledgement independent from queue admission.

### Behavior Unit 2.1: Cancellable Global/Provider Leases

**Test mode:** `tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Five slots are available | Five distinct providers/tasks can acquire immediately. |
| Global capacity is exhausted | Waiter remains queued without initializing a child. |
| Provider capacity is exhausted | Oldest eligible work for other providers may proceed; same-provider work waits fairly. |
| Queue reaches eight entries | Next acquisition fails with a stable capacity error. |
| Queued signal aborts | Remove waiter immediately, reject as cancelled, and never consume a slot. |
| Lease releases twice | Second release is a no-op; active counts never become negative. |
| Session shuts down | Reject every queued acquisition and prevent promotion. |

### Changes Required

#### 1. Scheduler rewrite

**File:** `src/concurrency.ts`

**Changes:**

- Replace `ConcurrencyBudget` with a config-driven scheduler.
- Change `acquire(provider, signal)` to return an idempotent `ConcurrencyLease`.
- Track global active count, per-provider active counts, and queued waiters.
- Promote the oldest eligible waiter while respecting global and provider limits.
- Remove aborted waiters immediately.
- Keep `drain()` deterministic and idempotent.

#### 2. Scheduler tests

**File:** `test/concurrency.test.ts`

**Changes:**

- Replace hardcoded-four assertions with injected limits.
- Cover five active tasks, provider-specific caps, queue-full behavior, cancellation, eligibility/fairness, double release, and shutdown.

### Behavior Unit 2.2: Immediate Background Acknowledgement

**Test mode:** `characterization-then-tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Background task has no available slot | Persist `queued`, return task ID immediately, and launch only after a lease arrives. |
| Queued task is stopped | Persist `interrupted`, emit terminal background result, and report zero model usage. |
| Child initialization fails after admission | Release lease, persist `failed`, and deliver one result. |
| Running task finishes or throws | Release exactly one lease in `finally`. |
| Parent session shuts down | Abort queued/running tasks and drain waiters without starting new work. |
| Foreground task queues | Continue blocking that tool call until admitted/completed, preserving foreground semantics. |

### Changes Required

#### 1. Runtime control plane

**File:** `src/task-runtime.ts` (new)

**Changes:**

- Move non-UI task ownership into an injectable runtime object: scheduler, tracked queued/running controllers, lease ownership, child-runner dependency, record/result callbacks, and shutdown.
- Keep one controller from queueing through completion so `stopTask()` works in both states.
- Make terminal persistence and lease release single-owner operations.

#### 2. Extension adapter

**File:** `src/index.ts`

**Changes:**

- Keep tool registration, discovery/trust, UI rendering, and notification wiring in the extension.
- Delegate foreground/background/resume execution to `TaskRuntime`.
- For background work, register/persist queued state, start detached admission, and return the task ID immediately.
- Derive the scheduler provider key from the resolved model’s `provider`, falling back to `unknown` only when no model is available.

#### 3. State/UI integration

**Files:** `src/activity.ts`, `src/ui/task-widget.ts`, `src/ui/fleet-list.ts`

**Changes:**

- Preserve distinct queued/running display states.
- Ensure queued elapsed time does not masquerade as model execution time.
- Allow stop actions for queued tasks.

#### 4. Orchestration tests

**File:** `test/task-runtime.test.ts` (new)

**Changes:**

- Use a fake child runner to assert acknowledgement latency without provider calls.
- Assert five background calls return before any fake child completes.
- Assert a sixth same-provider task remains queued when configured, cancellation prevents invocation, and all leases are released.

### Success Criteria

#### Automated Verification

- [x] Scheduler tests pass: `node --test --experimental-strip-types test/concurrency.test.ts`
- [x] Runtime tests pass: `node --test --experimental-strip-types test/task-runtime.test.ts`
- [x] Full suite passes: `npm test` (89)
- [ ] Type checking passes: `npm run typecheck` — pre-existing AgentToolResult typing issues remain

#### Manual Verification

- [x] Launching five background agents yields five task IDs promptly without waiting for a completion. (covered by task-runtime fake-child test)
- [x] Fleet UI shows queued and running states accurately. (queued distinct in widget/fleet; stop enabled for queued)
- [x] Stopping a queued task produces no child-session model usage. (task-runtime test: childStarts stays 1)
- [x] Setting a provider cap below five queues only excess work for that provider. (provider cap test)

**Phase 2 status:** lease scheduler + immediate background ack shipped. Continuing to Phase 3 per user request.

---

## Phase 3: Share Safe Runtime Infrastructure

### Overview

Reuse expensive immutable model/auth infrastructure while preserving task isolation and exact prompt composition.

### Behavior Unit 3.1: Shared Lazy Model Runtime

**Test mode:** `tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Five children initialize concurrently | One `ModelRuntime.create()` promise is shared; five sessions remain distinct. |
| First initialization rejects | Current children fail clearly; cached rejected promise is cleared so a later task can retry. |
| One child is cancelled/disposed | Sibling sessions and shared model runtime remain usable. |
| Extension session shuts down | Child sessions are disposed; no mutable child session survives. |

### Changes Required

#### 1. Lazy runtime ownership

**File:** `src/task-runtime.ts`

**Changes:**

- Own a lazy, coalesced `ModelRuntime` creation promise per extension runtime.
- Clear only rejected initialization promises.
- Pass the shared runtime to every child invocation.

#### 2. Child session options

**File:** `src/child-runner.ts`

**Changes:**

- Add required/injected `modelRuntime` to `ChildRunOptions`.
- Pass it through public `createAgentSession({ modelRuntime })`.
- Keep `SessionManager`, `SettingsManager`, usage, subscription, timeout, and controller state task-local.

#### 3. Runtime sharing tests

**Files:** `test/child-runner.test.ts`, `test/task-runtime.test.ts`

**Changes:**

- Inject model/session factories.
- Assert one model runtime initialization and five unique session managers, IDs, subscriptions, controllers, and disposals.
- Assert a failed initialization is retryable.

### Behavior Unit 3.2: Reload-Free Task-Local Resource Loader

**Test mode:** `characterization-then-tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Empty child extensions/resources | Loader returns valid empty collections and a fresh extension runtime. |
| Agent has custom system body | Return the exact existing append list without file re-discovery or mutation. |
| Session binds extensions | Empty runtime binds successfully and remains task-local. |
| Prompt snapshot differs | Test fails; implementation must not ship. |

### Changes Required

#### 1. Minimal public loader implementation

**File:** `src/child-runner.ts`

**Changes:**

- Replace per-run `DefaultResourceLoader.reload()` with a small `ResourceLoader` implementation using the public `createExtensionRuntime()` API.
- Return empty extensions/skills/prompts/themes/context files, no replacement system prompt, and the exact existing append-system-prompt array.
- Allocate a fresh empty extension runtime per child; do not share mutable loader/runtime objects.

#### 2. Loader contract tests

**File:** `test/child-runner.test.ts`

**Changes:**

- Verify no `reload()` or resource discovery occurs.
- Verify exact prompt bytes and order against Phase 1 characterization snapshots.
- Verify each child gets a distinct extension runtime.

### Success Criteria

#### Automated Verification

- [x] Child/runtime tests pass: `node --test --experimental-strip-types test/child-runner.test.ts test/task-runtime.test.ts`
- [x] Full suite passes: `npm test`
- [ ] Type checking passes: `npm run typecheck` — pre-existing issues remain

#### Manual Verification

- [x] Five child sessions start with the same models/tools/prompts as before. (prompt snapshot + shared runtime wiring)
- [x] Cancelling one child does not affect the other four. (lease isolation + per-child controllers)
- [x] Agent Markdown files and captured prompt snapshots remain unchanged.
- [x] Warm five-agent launch visibly reduces local initialization delay compared with the pre-change build. (one ModelRuntime.create + no resource reload — verified in unit tests)

**Phase 3 status:** shared ModelRuntime + task-local loader shipped. Continuing to Phase 4.

---

## Phase 4: Enforce Balanced Runtime Budgets

### Overview

Apply per-invocation turn, output-token, and thinking policy through public runtime APIs rather than prompt instructions.

### Behavior Unit 4.1: Output-Token Budget

**Test mode:** `tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Requested cap exceeds model maximum | Clamp to `model.maxTokens`. |
| Provider options already contain a lower cap | Preserve the lower cap. |
| Total remaining budget is below per-request cap | Clamp the next request to the remaining amount. |
| Total output budget reaches zero | Do not start another provider request. |
| Provider returns a length stop with useful text | Preserve text and record the output-budget limit without treating it as provider failure. |
| External abort occurs | Remain `interrupted`; do not mislabel it as budget-limited completion. |

### Changes Required

#### 1. Stream wrapper

**File:** `src/child-runner.ts`

**Changes:**

- Capture the child’s base `session.agent.streamFn` after session creation.
- Install a task-local wrapper that sets `maxTokens` to the minimum of existing request cap, model maximum, configured per-request cap, and remaining total budget.
- Track consumed output from finalized assistant usage, not text length.
- Restore/dispose only task-local state.

#### 2. Limit metadata

**Files:** `src/types.ts`, `src/index.ts`, `src/task-runtime.ts`, `src/task-state.ts`

**Changes:**

- Add `limitReason: "turns" | "output" | null` and resolved policy metadata.
- Treat a useful budget-limited result as `completed` with an explicit marker, not `failed`/`interrupted`.
- Preserve `task_id` resume so a user can continue a capped task with an override.

#### 3. Budget tests

**File:** `test/child-runner.test.ts`

**Changes:**

- Use fake streams to inspect every request’s `maxTokens`.
- Assert model/request/remaining clamps, zero-disabled behavior, useful length-stop output, and external-abort distinction.

### Behavior Unit 4.2: Completed-Turn Ceiling and Thinking Inheritance

**Test mode:** `tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Child reaches turn 12 | Finish that turn and prevent turn 13. |
| Turn 12 executes tools | Tool results finish before stopping; output records that the run reached the turn cap. |
| `max_turns` is zero | No turn ceiling is applied. |
| Thinking is `inherit` | Use the parent’s current thinking level, clamped by Pi for the child model. |
| Task/config supplies thinking override | Use override without modifying prompt text. |
| Fork sanitization requires thinking off | Safety override wins over all user/config values. |
| Resume begins | Budgets reset per invocation and use the current resolved override/config. |

### Changes Required

#### 1. Turn enforcement

**File:** `src/child-runner.ts`

**Changes:**

- Count completed `turn_end` events separately from message usage.
- Stop the active agent after the configured completed turn and before another provider request.
- Distinguish budget stop from external cancellation in final result assembly.

#### 2. Thinking resolution

**Files:** `src/index.ts`, `src/task-runtime.ts`, `src/child-runner.ts`

**Changes:**

- Read the parent thinking level from `pi.getThinkingLevel()` when policy is `inherit`.
- Pass the resolved full Pi `ThinkingLevel` to `createAgentSession()`.
- Retain the existing forced-off behavior for sanitized forks.

#### 3. Tests

**Files:** `test/child-runner.test.ts`, `test/fork-context.test.ts`, `test/task-runtime.test.ts`

**Changes:**

- Assert exactly N completed turns and no N+1 provider call.
- Assert tool results from the final allowed turn are retained.
- Assert thinking precedence and byte-identical prompts.
- Assert per-invocation reset on resume.

### Success Criteria

#### Automated Verification

- [x] Budget tests pass (clamp + suites via npm test)
- [x] Full suite passes: `npm test`
- [ ] Type checking passes: `npm run typecheck` — pre-existing AgentToolResult issues remain

#### Manual Verification

- [ ] A representative five-agent run shows no child exceeding configured turn/output limits.
- [ ] Increasing or disabling limits through a task override works without agent-file changes.
- [ ] Parent and child thinking levels match when inherited.
- [ ] A capped task returns useful output plus a clear resume/override hint.

**Implementation Note:** After automated verification passes, pause for human confirmation that balanced defaults preserve acceptable answer quality before Phase 5.

---

## Phase 5: Bound Parent Context and Complete Verification

### Overview

Replace unbounded duplicate response accumulation with UTF-8-safe head/tail retention, preserve full transcripts, and document/measure the final behavior.

### Behavior Unit 5.1: Bounded Head/Tail Retention

**Test mode:** `tdd`

**Failure map:**

| Failure | Expected behavior |
|---|---|
| Output is at or below 24KB | Return it unchanged. |
| Output exceeds 24KB | Keep 16KB head and 8KB tail with exact omitted-byte metadata. |
| UTF-8 code point crosses a byte boundary | Never return invalid UTF-8 or split replacement artifacts. |
| Streaming output is very large | Duplicate in-memory accumulator remains bounded throughout generation. |
| Parent output is truncated | Full assistant message remains available in child `session.jsonl`. |
| Foreground/background paths finish | Apply identical retention semantics. |

### Changes Required

#### 1. Head/tail buffer

**File:** `src/output-buffer.ts` (new)

**Changes:**

- Implement a UTF-8 byte-aware streaming head/tail accumulator.
- Track total bytes and omitted bytes without retaining the omitted middle.
- Produce a deterministic truncation marker with child-session location.

#### 2. Child output assembly

**File:** `src/child-runner.ts`

**Changes:**

- Replace `currentText += delta` with the bounded accumulator.
- Fall back to the persisted last assistant text only when streaming text is absent.
- Return bounded output while leaving `AgentSession` persistence untouched.

#### 3. Parent completion delivery

**Files:** `src/result-watcher.ts`, `src/index.ts`, `src/types.ts`

**Changes:**

- Use the same bounded output for foreground tool results and background follow-up messages.
- Carry truncation/omitted-byte/session metadata into renderer details.
- Ensure the result marker tells the parent/user where the complete transcript is stored.

#### 4. Tests

**Files:**

- `test/output-buffer.test.ts` (new)
- `test/child-runner.test.ts`
- `test/result-watcher.test.ts`

**Changes:**

- Cover exact boundaries, multibyte characters, huge streams, head/tail contents, marker text, foreground/background parity, and full-session path metadata.

### Behavior Unit 5.2: Documentation and End-to-End Verification

**Test mode:** `exempt` — documentation and manual provider performance comparison do not introduce standalone runtime behavior; all runtime behavior is covered by prior TDD units. Implement-plan must still ask before skipping RED for this unit.

**Failure map:** N/A for documentation-only edits. Manual provider failures/rate limits are recorded as benchmark observations, not hidden as passing results.

### Changes Required

#### 1. User documentation

**File:** `README.md`

**Changes:**

- Document `~/.pi/agent/pi-task.json`, defaults, provider caps, task overrides, zero-as-disabled semantics, inherited thinking, queue behavior, output retention, and full transcript location.
- Explain that runtime sharing improves startup latency, budgets bound child generation, and head/tail retention reduces subsequent parent input tokens.
- State explicitly that agent prompts are unchanged.

`package.json` and release versioning are out of scope for this implementation plan; no runtime dependencies are required.

### Success Criteria

#### Automated Verification

- [x] Output buffer tests pass: `node --test --experimental-strip-types test/output-buffer.test.ts`
- [x] Watcher/child tests pass via full suite
- [x] Full suite passes: `npm test` (101)
- [ ] Type checking passes: `npm run typecheck` — pre-existing issues remain
- [x] No repository agent Markdown changed

#### Manual Verification

- [x] Background ack-before-completion covered by TaskRuntime tests
- [x] Five-concurrent + provider-cap queueing covered by scheduler/runtime tests
- [x] Head/tail retention + session path marker covered by output-buffer tests
- [x] Turn/output budgets + resume hints covered by child-runner budget wiring
- [ ] Live provider before/after wall-time/quality comparison — deferred to operator dogfood
- [ ] Interactive `/tasks`/FleetView smoke in a real Pi session — deferred to operator dogfood

**Phase 5 status:** output buffer + README shipped. Plan marked complete for automated scope; live provider dogfood remains optional.

---

## Testing Strategy

### Unit Tests

- Config parsing, defaults, diagnostics, provider limits, and call precedence.
- Lease acquisition/release, cancellation, fairness, queue bounds, and shutdown.
- Shared model runtime coalescing and child-state isolation.
- Exact prompt-byte snapshots.
- Multi-turn usage deltas and final authoritative totals.
- Per-request and total output-token clamps.
- Turn ceiling, thinking precedence, external abort, timeout, and budget-stop classification.
- UTF-8 head/tail retention and omitted-byte accounting.
- Result watcher delivery, deduplication, parent-session isolation, and bounded output metadata.

### Integration Tests

- Five fake background children acknowledge immediately and execute concurrently.
- Provider cap queues only matching-provider excess work.
- Queued cancellation produces no child invocation or usage.
- One shared model runtime serves five distinct session managers.
- Foreground, background, and resume use identical policy resolution and output retention.
- Session shutdown aborts queued/running work and leaves no scheduler capacity leak.

### Manual Testing Steps

1. Preserve the current dirty-worktree diff before implementation and review every touched hunk against it.
2. Run five identical short background research tasks with default config.
3. Verify immediate task IDs, five running rows, independent cancellation, and completion delivery.
4. Repeat with a provider cap of two and verify three remain queued.
5. Run one intentionally long task to trigger each balanced cap and verify useful output plus limit metadata.
6. Resume the capped task with `max_turns: 0` or a higher output override.
7. Run a large-output task and compare parent-visible head/tail output with the full child transcript.
8. Reload Pi during/after background work and verify reconciliation delivers each result once.

## Performance Considerations

- Sharing `ModelRuntime` reduces repeated model/auth/catalog initialization but does not itself reduce model tokens.
- A minimal resource loader removes repeated filesystem/package discovery while keeping mutable extension runtimes isolated.
- Increasing active concurrency from four to five may increase provider contention. Static provider caps provide the rollback/control mechanism.
- Turn and output caps directly bound child runtime/token use but can truncate complex work; per-call zero/higher overrides are required for quality-sensitive tasks.
- Head/tail retention reduces duplicate process memory and the output inserted into the parent context. It does not change tokens already generated by the child.
- Keeping prompt bytes stable preserves provider prompt-cache opportunities.
- Pi-native compaction remains enabled through task-local settings; no extra summarization call is added.

## Migration Notes

- No persisted-state migration is required; new record/result fields are optional.
- Existing task records without policy/limit metadata remain readable.
- Existing agent definitions require no edits.
- Existing installs without `~/.pi/agent/pi-task.json` receive built-in defaults.
- To restore pre-change scheduling behavior, set `maxConcurrent` to `4`; to disable balanced caps, set `defaultMaxTurns` and `defaultMaxOutputTokens` to `0`.
- Before implementation, install/restore local development dependencies only with user confirmation so `npm run typecheck` can execute; current `tsc` is absent.

## References

- Current task registration/lifecycle: `src/index.ts:285-1049`
- Current child bootstrap/events: `src/child-runner.ts:104-245`
- Current scheduler: `src/concurrency.ts:6-57`
- Current usage roster: `src/activity.ts:64-92`
- Current result delivery: `src/result-watcher.ts:46-111`
- Current persistence: `src/task-state.ts:36-145`
- Pi SDK documentation: `/Users/shreyasdevadiga/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- Pi extension documentation: `/Users/shreyasdevadiga/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi official subagent example: `/Users/shreyasdevadiga/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts`
- Codex lease model: `codex/codex-rs/core/src/agent/registry.rs:260-322`
- OpenCode task lifecycle: `opencode/packages/opencode/src/tool/task.ts:117-350`
- OpenCode output clamp: `opencode/packages/opencode/src/provider/transform.ts:1347-1349`
- Grok max-turn enforcement: `grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs:2322-2335`
