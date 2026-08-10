import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
	HANDOFF_MANIFEST_BUDGET_BYTES,
	HandoffManifestError,
	buildHandoffManifest,
	snapshotEvidenceRef,
	validateHandoffManifest,
	writeHandoffManifest,
} from "../builtin/iteration-handoff.js";
import {
	iterationContinuationOptions,
	resolveHandoffPolicy,
} from "../builtin/iteration-context.js";

describe("iteration handoff manifests", () => {
	test("iterationContinuationOptions defaults to fresh and only forks when requested", () => {
		assert.deepEqual(iterationContinuationOptions("fresh", "/tmp/a.jsonl"), { context: "fresh" });
		assert.deepEqual(iterationContinuationOptions("fork", undefined), { context: "fresh" });
		assert.deepEqual(iterationContinuationOptions("fork", "/tmp/a.jsonl"), {
			context: "fork",
			forkFromSessionFile: "/tmp/a.jsonl",
		});
	});

	test("persists launch-time handoff policy and refuses mid-run flips", async () => {
		const artifactDir = mkdtempSync(join(tmpdir(), "handoff-policy-"));
		const first = await resolveHandoffPolicy({
			artifactDir,
			requested: "fresh",
		});
		assert.equal(first.iteration_context, "fresh");
		const second = await resolveHandoffPolicy({
			artifactDir,
			requested: "fork",
		});
		assert.equal(second.iteration_context, "fresh");
	});

	test("writes and validates a bounded handoff under the trusted artifact root", () => {
		const artifactDir = mkdtempSync(join(tmpdir(), "handoff-manifest-"));
		const notesPath = join(artifactDir, "notes.md");
		writeFileSync(notesPath, "failed approach: skipped X because Y\n");
		const evidence = [
			snapshotEvidenceRef({
				artifactRoot: artifactDir,
				path: notesPath,
				role: "implementation_notes",
				iteration: 1,
			}),
		];
		const manifestPath = writeHandoffManifest({
			artifactRoot: artifactDir,
			manifest: buildHandoffManifest({
				workflow: "ralph",
				iteration: 1,
				iterationContext: "fresh",
				objective: "Ship fresh sessions",
				acceptanceCriteria: "Ship fresh sessions",
				unresolvedFindings: [{ title: "[P1] gap", priority: 1 }],
				approved: false,
				status: "needs_repair",
				nextAction: "implementation",
				evidence,
				failedApproachesRef: evidence[0],
			}),
		});
		const validated = validateHandoffManifest({
			artifactRoot: artifactDir,
			manifestPath,
		});
		assert.equal(validated.contract.objective, "Ship fresh sessions");
		assert.equal(validated.unresolved_findings[0]?.title, "[P1] gap");
		assert.equal(validated.evidence.length, 1);
	});

	test("rejects missing, over-budget, escaped, and integrity-invalid handoffs before stage admission", () => {
		const artifactDir = mkdtempSync(join(tmpdir(), "handoff-invalid-"));
		assert.throws(
			() =>
				validateHandoffManifest({
					artifactRoot: artifactDir,
					manifestPath: join(artifactDir, "missing.json"),
				}),
			(error: unknown) => error instanceof HandoffManifestError && error.code === "missing",
		);

		const outside = mkdtempSync(join(tmpdir(), "handoff-outside-"));
		const outsideFile = join(outside, "escape.md");
		writeFileSync(outsideFile, "nope\n");
		const forgedPath = join(artifactDir, "forged-escape.json");
		writeFileSync(
			forgedPath,
			`${JSON.stringify(
				{
					schema_version: 1,
					workflow: "ralph",
					iteration: 1,
					iteration_context: "fresh",
					written_at: new Date().toISOString(),
					contract: { objective: "o", acceptance_criteria: "o", user_amendments: [] },
					constraints: { notes: "n" },
					unresolved_findings: [],
					validation: { approved: false, diagnostics: [] },
					evidence: [{ path: outsideFile, sha256: "abc", role: "escape" }],
				},
				null,
				2,
			)}\n`,
		);
		assert.throws(
			() =>
				validateHandoffManifest({
					artifactRoot: artifactDir,
					manifestPath: forgedPath,
				}),
			(error: unknown) => error instanceof HandoffManifestError && error.code === "trust_boundary",
		);

		const notesPath = join(artifactDir, "notes.md");
		writeFileSync(notesPath, "ok\n");
		const evidence = [
			snapshotEvidenceRef({
				artifactRoot: artifactDir,
				path: notesPath,
				role: "notes",
				iteration: 1,
			}),
		];
		const manifestPath = writeHandoffManifest({
			artifactRoot: artifactDir,
			manifest: buildHandoffManifest({
				workflow: "goal",
				iteration: 1,
				iterationContext: "fresh",
				objective: "obj",
				acceptanceCriteria: "obj",
				approved: false,
				evidence,
			}),
		});
		writeFileSync(evidence[0]!.path, "tampered\n");
		assert.throws(
			() =>
				validateHandoffManifest({
					artifactRoot: artifactDir,
					manifestPath,
				}),
			(error: unknown) => error instanceof HandoffManifestError && error.code === "integrity",
		);

		const hugeDir = mkdtempSync(join(tmpdir(), "handoff-huge-"));
		const hugeNotes = join(hugeDir, "notes.md");
		writeFileSync(hugeNotes, "x\n");
		const hugeEvidence = [
			snapshotEvidenceRef({
				artifactRoot: hugeDir,
				path: hugeNotes,
				role: "notes",
				iteration: 1,
			}),
		];
		assert.throws(
			() =>
				writeHandoffManifest({
					artifactRoot: hugeDir,
					manifest: buildHandoffManifest({
						workflow: "ralph",
						iteration: 1,
						iterationContext: "fresh",
						objective: "o".repeat(HANDOFF_MANIFEST_BUDGET_BYTES),
						acceptanceCriteria: "o".repeat(HANDOFF_MANIFEST_BUDGET_BYTES),
						approved: false,
						evidence: hugeEvidence,
					}),
				}),
			(error: unknown) => error instanceof HandoffManifestError && error.code === "over_budget",
		);

		const linkDir = mkdtempSync(join(tmpdir(), "handoff-link-"));
		const realFile = join(linkDir, "real.md");
		writeFileSync(realFile, "real\n");
		const linkPath = join(linkDir, "link.md");
		try {
			symlinkSync(realFile, linkPath);
			assert.throws(
				() =>
					snapshotEvidenceRef({
						artifactRoot: linkDir,
						path: linkPath,
						role: "link",
						iteration: 1,
					}),
				(error: unknown) =>
					error instanceof HandoffManifestError && error.code === "trust_boundary",
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") {
				assert.ok(true);
			} else if (error instanceof HandoffManifestError) {
				assert.equal(error.code, "trust_boundary");
			} else {
				throw error;
			}
		}
	});
});
