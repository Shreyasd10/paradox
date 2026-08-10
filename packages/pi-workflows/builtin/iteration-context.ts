/**
 * Shared iteration-context helpers for builtin looped workflows.
 *
 * Default every built-in looped iteration to `fresh` sessions. `"fork"` remains
 * a transitional rollback mode for two minor releases; prefer artifact handoffs.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ITERATION_CONTEXT_FRESH = "fresh" as const;
export const ITERATION_CONTEXT_FORK = "fork" as const;

export type IterationContextMode =
  | typeof ITERATION_CONTEXT_FRESH
  | typeof ITERATION_CONTEXT_FORK;

export const HANDOFF_POLICY_FILENAME = "handoff-policy.json";
export const HANDOFF_POLICY_SCHEMA_VERSION = 1 as const;

/** Documented transitional lifetime for `"fork"` rollback mode. */
export const FORK_ROLLBACK_SUPPORT_NOTE =
  'iteration_context "fork" is a transitional rollback mode supported for two minor releases. Prefer "fresh" (default), which re-grounds each iteration from bounded artifact handoffs.';

export type HandoffPolicy = {
  readonly schema_version: typeof HANDOFF_POLICY_SCHEMA_VERSION;
  readonly iteration_context: IterationContextMode;
  readonly written_at: string;
};

export type IterationContinuationOptions =
  | { readonly context: "fresh" }
  | { readonly context: "fork"; readonly forkFromSessionFile: string };

export function parseIterationContext(
  value: unknown,
): IterationContextMode | undefined {
  if (value === ITERATION_CONTEXT_FRESH || value === ITERATION_CONTEXT_FORK) {
    return value;
  }
  return undefined;
}

/**
 * Resolve continuation options for a looped stage.
 *
 * - `fresh` always starts a new session (even when a prior session file exists).
 * - `fork` continues from the prior matching-role session when available.
 */
export function iterationContinuationOptions(
  mode: IterationContextMode,
  sessionFile: string | undefined,
): IterationContinuationOptions {
  if (
    mode === ITERATION_CONTEXT_FORK &&
    sessionFile !== undefined &&
    sessionFile.length > 0
  ) {
    return { context: "fork", forkFromSessionFile: sessionFile };
  }
  return { context: "fresh" };
}

/** @deprecated Use {@link iterationContinuationOptions} with an explicit mode. */
export function forkContinuationOptions(
  sessionFile: string | undefined,
): IterationContinuationOptions {
  return iterationContinuationOptions(ITERATION_CONTEXT_FORK, sessionFile);
}

export function handoffPolicyPath(artifactDir: string): string {
  return join(artifactDir, HANDOFF_POLICY_FILENAME);
}

/**
 * True when an existing run artifact directory has loop state but no handoff
 * policy — i.e. a pre-change run that must keep `"fork"` semantics on resume.
 */
export function hasLegacyLoopArtifacts(artifactDir: string): boolean {
  if (existsSync(handoffPolicyPath(artifactDir))) return false;
  return (
    existsSync(join(artifactDir, "review-round-latest.json")) ||
    existsSync(join(artifactDir, "goal-ledger.json")) ||
    existsSync(join(artifactDir, "feedback")) ||
    existsSync(join(artifactDir, "preview.html"))
  );
}

function isHandoffPolicy(value: unknown): value is HandoffPolicy {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema_version === HANDOFF_POLICY_SCHEMA_VERSION &&
    (record.iteration_context === ITERATION_CONTEXT_FRESH ||
      record.iteration_context === ITERATION_CONTEXT_FORK) &&
    typeof record.written_at === "string"
  );
}

/**
 * Persist launch-time iteration policy so resume/replay cannot switch modes
 * mid-run. Missing policy on an artifact directory that already has loop
 * artifacts is treated as legacy `"fork"` so pre-change runs keep semantics.
 */
export async function resolveHandoffPolicy(args: {
  readonly artifactDir: string;
  readonly requested?: IterationContextMode | undefined;
  readonly hasLegacyLoopArtifacts?: boolean;
}): Promise<HandoffPolicy> {
  const path = handoffPolicyPath(args.artifactDir);
  if (existsSync(path)) {
    const raw = await readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Invalid handoff policy at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!isHandoffPolicy(parsed)) {
      throw new Error(
        `Invalid handoff policy at ${path}: unsupported schema or iteration_context.`,
      );
    }
    return parsed;
  }

  const iterationContext =
    args.requested ??
    (args.hasLegacyLoopArtifacts === true
      ? ITERATION_CONTEXT_FORK
      : ITERATION_CONTEXT_FRESH);

  const policy: HandoffPolicy = {
    schema_version: HANDOFF_POLICY_SCHEMA_VERSION,
    iteration_context: iterationContext,
    written_at: new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return policy;
}
