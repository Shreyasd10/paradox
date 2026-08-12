/**
 * Bounded, versioned iteration handoff manifests for builtin looped workflows.
 *
 * The runner copies authoritative fields (contract, findings, validation,
 * evidence paths) rather than asking a model to summarize. Fresh iterations
 * re-ground from the validated latest manifest; fork mode still writes
 * manifests for audit but does not load them as iteration context.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { IterationContextMode } from "./iteration-context.js";

export const HANDOFF_MANIFEST_SCHEMA_VERSION = 1 as const;
export const HANDOFF_MANIFEST_BUDGET_BYTES = 48 * 1024;
export const HANDOFF_MANIFEST_DIRNAME = "handoffs";
export const HANDOFF_MANIFEST_LATEST_FILENAME = "handoff-latest.json";
export const HANDOFF_SNAPSHOT_DIRNAME = "snapshots";

export type HandoffWorkflowFamily = "ralph" | "goal" | "open-claude-design" | "rpi" | "prd-oriented";

export type HandoffEvidenceRef = {
  readonly path: string;
  readonly sha256: string;
  readonly role: string;
};

export type HandoffUnresolvedFinding = {
  readonly title?: string;
  readonly priority?: number | string | null;
  readonly objective_alignment?: string;
  readonly code_location?: string;
  readonly reviewer?: string;
};

export type HandoffManifest = {
  readonly schema_version: typeof HANDOFF_MANIFEST_SCHEMA_VERSION;
  readonly workflow: HandoffWorkflowFamily;
  readonly iteration: number;
  readonly iteration_context: IterationContextMode;
  readonly written_at: string;
  readonly contract: {
    readonly objective: string;
    readonly acceptance_criteria: string;
    readonly user_amendments: readonly string[];
  };
  readonly constraints: {
    readonly notes: string;
  };
  readonly unresolved_findings: readonly HandoffUnresolvedFinding[];
  readonly validation: {
    readonly approved: boolean;
    readonly status?: string;
    readonly next_action?: string;
    readonly diagnostics: readonly string[];
  };
  /** Pointers into notes/ledger for failed approaches; reasons live in those artifacts. */
  readonly failed_approaches_ref?: HandoffEvidenceRef;
  readonly evidence: readonly HandoffEvidenceRef[];
};

export class HandoffManifestError extends Error {
  readonly code:
    | "missing"
    | "unreadable"
    | "malformed"
    | "over_budget"
    | "integrity"
    | "trust_boundary";

  constructor(
    code: HandoffManifestError["code"],
    message: string,
  ) {
    super(message);
    this.name = "HandoffManifestError";
    this.code = code;
  }
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sha256OfFile(absolutePath: string): string {
  const bytes = readFileSync(absolutePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function assertTrustedRegularFile(
  artifactRoot: string,
  candidatePath: string,
): string {
  const rootReal = realpathSync(artifactRoot);
  const absolute = resolve(candidatePath);
  let candidateReal: string;
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new HandoffManifestError(
        "trust_boundary",
        `Handoff evidence path must not be a symlink: ${absolute}`,
      );
    }
    if (!stat.isFile()) {
      throw new HandoffManifestError(
        "trust_boundary",
        `Handoff evidence path must be a regular file: ${absolute}`,
      );
    }
    candidateReal = realpathSync(absolute);
  } catch (err) {
    if (err instanceof HandoffManifestError) throw err;
    throw new HandoffManifestError(
      "unreadable",
      `Handoff evidence path is unreadable: ${absolute}`,
    );
  }

  const rel = relative(rootReal, candidateReal);
  if (rel.startsWith(`..${sep}`) || rel === ".." || rel.startsWith("..")) {
    throw new HandoffManifestError(
      "trust_boundary",
      `Handoff evidence path escapes the trusted artifact root: ${absolute}`,
    );
  }
  return candidateReal;
}

export function createEvidenceRef(args: {
  readonly artifactRoot: string;
  readonly path: string;
  readonly role: string;
}): HandoffEvidenceRef {
  const trusted = assertTrustedRegularFile(args.artifactRoot, args.path);
  return {
    path: trusted,
    sha256: sha256OfFile(trusted),
    role: args.role,
  };
}

/**
 * Copy an authoritative artifact into the trusted handoff snapshot tree, then
 * return an evidence ref. Use this for paths that may live outside the run
 * artifact root (for example Ralph research reports under the repo).
 */
export function snapshotEvidenceRef(args: {
  readonly artifactRoot: string;
  readonly path: string;
  readonly role: string;
  readonly iteration: number;
}): HandoffEvidenceRef {
  const sourceAbsolute = resolve(args.path);
  if (!existsSync(sourceAbsolute)) {
    throw new HandoffManifestError(
      "missing",
      `Handoff evidence source is missing: ${sourceAbsolute}`,
    );
  }
  const sourceStat = lstatSync(sourceAbsolute);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new HandoffManifestError(
      "trust_boundary",
      `Handoff evidence source must be a regular file: ${sourceAbsolute}`,
    );
  }
  const snapshotDir = join(
    args.artifactRoot,
    HANDOFF_MANIFEST_DIRNAME,
    HANDOFF_SNAPSHOT_DIRNAME,
    `iteration-${args.iteration}`,
  );
  mkdirSync(snapshotDir, { recursive: true });
  const safeRole = args.role.replace(/[^A-Za-z0-9._-]+/g, "-");
  const destination = join(snapshotDir, `${safeRole}-${basename(sourceAbsolute)}`);
  copyFileSync(sourceAbsolute, destination);
  return createEvidenceRef({
    artifactRoot: args.artifactRoot,
    path: destination,
    role: args.role,
  });
}

export function handoffManifestDir(artifactRoot: string): string {
  return join(artifactRoot, HANDOFF_MANIFEST_DIRNAME);
}

export function handoffManifestPathForIteration(
  artifactRoot: string,
  iteration: number,
): string {
  return join(handoffManifestDir(artifactRoot), `handoff-iteration-${iteration}.json`);
}

export function handoffLatestManifestPath(artifactRoot: string): string {
  return join(artifactRoot, HANDOFF_MANIFEST_LATEST_FILENAME);
}

function isEvidenceRef(value: unknown): value is HandoffEvidenceRef {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === "string" &&
    typeof record.sha256 === "string" &&
    typeof record.role === "string"
  );
}

function isHandoffManifest(value: unknown): value is HandoffManifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.schema_version !== HANDOFF_MANIFEST_SCHEMA_VERSION) return false;
  if (
    record.workflow !== "ralph" &&
    record.workflow !== "goal" &&
    record.workflow !== "open-claude-design" &&
    record.workflow !== "rpi" &&
    record.workflow !== "prd-oriented"
  ) {
    return false;
  }
  if (typeof record.iteration !== "number" || !Number.isFinite(record.iteration)) {
    return false;
  }
  if (record.iteration_context !== "fresh" && record.iteration_context !== "fork") {
    return false;
  }
  if (typeof record.written_at !== "string") return false;
  if (typeof record.contract !== "object" || record.contract === null) return false;
  const contract = record.contract as Record<string, unknown>;
  if (
    typeof contract.objective !== "string" ||
    typeof contract.acceptance_criteria !== "string" ||
    !Array.isArray(contract.user_amendments)
  ) {
    return false;
  }
  if (typeof record.constraints !== "object" || record.constraints === null) return false;
  if (!Array.isArray(record.unresolved_findings)) return false;
  if (typeof record.validation !== "object" || record.validation === null) return false;
  if (!Array.isArray(record.evidence)) return false;
  if (!record.evidence.every(isEvidenceRef)) return false;
  if (
    record.failed_approaches_ref !== undefined &&
    !isEvidenceRef(record.failed_approaches_ref)
  ) {
    return false;
  }
  return true;
}

export function serializeHandoffManifest(manifest: HandoffManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function assertManifestWithinBudget(serialized: string, pathForError: string): void {
  const bytes = utf8ByteLength(serialized);
  if (bytes > HANDOFF_MANIFEST_BUDGET_BYTES) {
    throw new HandoffManifestError(
      "over_budget",
      `Handoff manifest exceeds ${HANDOFF_MANIFEST_BUDGET_BYTES} byte budget (${bytes} bytes) at ${pathForError}`,
    );
  }
}

export function writeHandoffManifest(args: {
  readonly artifactRoot: string;
  readonly manifest: HandoffManifest;
}): string {
  const iterationPath = handoffManifestPathForIteration(
    args.artifactRoot,
    args.manifest.iteration,
  );
  mkdirSync(dirname(iterationPath), { recursive: true });
  const serialized = serializeHandoffManifest(args.manifest);
  assertManifestWithinBudget(serialized, iterationPath);
  writeFileSync(iterationPath, serialized, { encoding: "utf8" });
  const latestPath = handoffLatestManifestPath(args.artifactRoot);
  writeFileSync(latestPath, serialized, { encoding: "utf8" });
  return latestPath;
}

/**
 * Validate a required handoff manifest before admitting the next fresh stage.
 * Rejects missing, unreadable, malformed, over-budget, trust-boundary, and
 * integrity-invalid manifests. Never continues with partial context.
 */
export function validateHandoffManifest(args: {
  readonly artifactRoot: string;
  readonly manifestPath: string;
}): HandoffManifest {
  const absolute = resolve(args.manifestPath);
  if (!existsSync(absolute)) {
    throw new HandoffManifestError(
      "missing",
      `Required handoff manifest is missing: ${absolute}`,
    );
  }

  let trustedPath: string;
  try {
    trustedPath = assertTrustedRegularFile(args.artifactRoot, absolute);
  } catch (err) {
    if (err instanceof HandoffManifestError) throw err;
    throw new HandoffManifestError(
      "unreadable",
      `Required handoff manifest is unreadable: ${absolute}`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(trustedPath, "utf8");
  } catch {
    throw new HandoffManifestError(
      "unreadable",
      `Required handoff manifest is unreadable: ${trustedPath}`,
    );
  }

  assertManifestWithinBudget(raw, trustedPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HandoffManifestError(
      "malformed",
      `Required handoff manifest is malformed JSON at ${trustedPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isHandoffManifest(parsed)) {
    throw new HandoffManifestError(
      "malformed",
      `Required handoff manifest failed schema validation at ${trustedPath}`,
    );
  }

  for (const evidence of parsed.evidence) {
    const trustedEvidence = assertTrustedRegularFile(args.artifactRoot, evidence.path);
    const digest = sha256OfFile(trustedEvidence);
    if (digest !== evidence.sha256) {
      throw new HandoffManifestError(
        "integrity",
        `Handoff evidence SHA-256 mismatch for ${evidence.role} at ${trustedEvidence}`,
      );
    }
  }
  if (parsed.failed_approaches_ref !== undefined) {
    const trusted = assertTrustedRegularFile(
      args.artifactRoot,
      parsed.failed_approaches_ref.path,
    );
    const digest = sha256OfFile(trusted);
    if (digest !== parsed.failed_approaches_ref.sha256) {
      throw new HandoffManifestError(
        "integrity",
        `Handoff failed-approaches SHA-256 mismatch at ${trusted}`,
      );
    }
  }

  return parsed;
}

export function buildHandoffManifest(args: {
  readonly workflow: HandoffWorkflowFamily;
  readonly iteration: number;
  readonly iterationContext: IterationContextMode;
  readonly objective: string;
  readonly acceptanceCriteria: string;
  readonly userAmendments?: readonly string[];
  readonly constraintsNotes?: string;
  readonly unresolvedFindings?: readonly HandoffUnresolvedFinding[];
  readonly approved: boolean;
  readonly status?: string;
  readonly nextAction?: string;
  readonly diagnostics?: readonly string[];
  readonly evidence: readonly HandoffEvidenceRef[];
  readonly failedApproachesRef?: HandoffEvidenceRef;
}): HandoffManifest {
  return {
    schema_version: HANDOFF_MANIFEST_SCHEMA_VERSION,
    workflow: args.workflow,
    iteration: args.iteration,
    iteration_context: args.iterationContext,
    written_at: new Date().toISOString(),
    contract: {
      objective: args.objective,
      acceptance_criteria: args.acceptanceCriteria,
      user_amendments: args.userAmendments ?? [],
    },
    constraints: {
      notes:
        args.constraintsNotes ??
        "Active constraints, architectural decisions, and permissions live in the linked notes/ledger evidence.",
    },
    unresolved_findings: args.unresolvedFindings ?? [],
    validation: {
      approved: args.approved,
      ...(args.status === undefined ? {} : { status: args.status }),
      ...(args.nextAction === undefined ? {} : { next_action: args.nextAction }),
      diagnostics: args.diagnostics ?? [],
    },
    ...(args.failedApproachesRef === undefined
      ? {}
      : { failed_approaches_ref: args.failedApproachesRef }),
    evidence: args.evidence,
  };
}
