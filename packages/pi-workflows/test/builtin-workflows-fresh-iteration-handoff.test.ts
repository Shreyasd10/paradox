import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { WorkflowDefinition } from "../src/shared/types.js";
import {
	HANDOFF_MANIFEST_BUDGET_BYTES,
	handoffLatestManifestPath,
	validateHandoffManifest,
} from "../builtin/iteration-handoff.js";
import { makeMockCtx } from "./helpers/builtin-workflows-helpers.js";

describe("fresh iteration handoff fixtures", () => {
	test("Ralph iteration 2+ uses distinct fresh sessions, validates the latest manifest, and stays in budget", async () => {
		const mod = await import("../builtin/ralph.js");
		const cwd = mkdtempSync(join(tmpdir(), "fresh-ralph-"));
		const ctx = makeMockCtx(
			{
				prompt: "Fresh handoff fixture",
				acceptance_criteria: "Fresh handoff fixture",
				max_loops: 2,
				base_branch: "main",
				git_worktree_dir: "",
				create_pr: false,
			},
			{
				sessionFile: (name) => `/tmp/fresh-ralph-${name}.jsonl`,
			},
		);

		try {
			await mod.default.run({ ...ctx, cwd });
			assert.equal(ctx.calls.taskOptions["orchestrator-1"]?.[0]?.context, "fresh");
			assert.equal(ctx.calls.taskOptions["orchestrator-2"]?.[0]?.context, "fresh");
			assert.equal(ctx.calls.taskOptions["orchestrator-2"]?.[0]?.forkFromSessionFile, undefined);
			assert.notEqual(
				ctx.calls.taskOptions["orchestrator-1"]?.[0]?.sessionFile ??
					"/tmp/fresh-ralph-orchestrator-1.jsonl",
				ctx.calls.taskOptions["orchestrator-2"]?.[0]?.sessionFile ??
					"/tmp/fresh-ralph-orchestrator-2.jsonl",
			);

			const orchestratorReads = ctx.calls.taskOptions["orchestrator-2"]?.[0]?.reads ?? [];
			const manifestPath = orchestratorReads.find((path) => path.endsWith("handoff-latest.json"));
			assert.ok(manifestPath, "expected handoff-latest.json in orchestrator-2 reads");
			assert.equal(existsSync(manifestPath), true);
			const artifactDir = manifestPath.replace(/\/handoff-latest\.json$/, "");
			const validated = validateHandoffManifest({ artifactRoot: artifactDir, manifestPath });
			assert.equal(validated.contract.objective, "Fresh handoff fixture");
			assert.equal(validated.contract.acceptance_criteria, "Fresh handoff fixture");
			assert.ok(validated.evidence.some((entry) => entry.role === "review_round"));
			assert.ok(
				Buffer.byteLength(readFileSync(manifestPath, "utf8"), "utf8") <= HANDOFF_MANIFEST_BUDGET_BYTES,
			);
			assert.ok(
				(ctx.calls.taskOptions["orchestrator-2"]?.[0]?.reads ?? []).some((path) =>
					path.endsWith("handoff-latest.json"),
				),
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("Goal iteration 2+ uses fresh sessions and preserves ledger/review evidence in the manifest", async () => {
		const mod = await import("../builtin/goal.js");
		const d = mod.default as unknown as WorkflowDefinition;
		const reviewJson = (decision: "continue" | "complete"): string =>
			JSON.stringify({
				findings:
					decision === "continue"
						? [
								{
									title: "[P1] Remaining gap",
									body: "Needs another pass",
									confidence_score: 0.9,
									objective_alignment: "required_by_objective",
									priority: 1,
									code_location: {
										absolute_file_path: "/tmp/example.ts",
										line_range: { start: 1, end: 2 },
									},
								},
							]
						: [],
				overall_correctness: decision === "complete" ? "patch is correct" : "patch is incorrect",
				overall_explanation: decision === "complete" ? "done" : "not done",
				overall_confidence_score: 0.9,
				stop_review_loop: decision === "complete",
				goal_oracle_satisfied: decision === "complete",
				requirements_traceability: [
					{
						requirement: "complete requested objective",
						status: decision === "complete" ? "proven" : "missing",
						evidence: decision === "complete" ? "closed" : "work remains",
					},
				],
				receipt_assessment: decision === "complete" ? "closed" : "work remains",
				verification_remaining: decision === "complete" ? "none" : "work remains",
			});
		const ctx = makeMockCtx(
			{ objective: "Fresh goal fixture", acceptance_criteria: "Fresh goal fixture" },
			{
				sessionFile: (name) => `/tmp/fresh-goal-${name}.jsonl`,
				task: (name, _options, calls) => {
					if (
						name.startsWith("completion-reviewer-") ||
						name.startsWith("evidence-reviewer-") ||
						name.startsWith("risk-reviewer-")
					) {
						const firstRound = calls.task.includes("orchestrator-2") === false;
						return firstRound ? reviewJson("continue") : reviewJson("complete");
					}
					return undefined;
				},
			},
		);

		const result = await d.run(ctx);
		assert.equal(result.status, "complete");
		assert.equal(ctx.calls.taskOptions["orchestrator-2"]?.[0]?.context, "fresh");
		assert.equal(ctx.calls.taskOptions["orchestrator-2"]?.[0]?.forkFromSessionFile, undefined);
		const ledgerPath = result.ledger_path as string;
		const artifactDir = ledgerPath.replace(/\/goal-ledger\.json$/, "");
		const manifestPath = handoffLatestManifestPath(artifactDir);
		const validated = validateHandoffManifest({ artifactRoot: artifactDir, manifestPath });
		assert.equal(validated.contract.objective, "Fresh goal fixture");
		assert.ok(validated.evidence.some((entry) => entry.role === "goal_ledger"));
		assert.ok(
			(ctx.calls.taskOptions["orchestrator-2"]?.[0]?.reads ?? []).some((path) =>
				path.endsWith("handoff-latest.json"),
			),
		);
	});

	test("Open-Claude-Design iteration 2+ stays fresh and threads annotation history through reads", async () => {
		const mod = await import("../builtin/open-claude-design.js");
		const d = mod.default as unknown as WorkflowDefinition;
		const previewWithAnnotations = [
			"display_method: playwright-cli interactive annotation",
			"preview_path: /tmp/preview.html",
			"user_notes:",
			"- Keep the brand mark dominant.",
			"next_action_hint: proceed to refinement",
		].join("\n");
		const ctx = makeMockCtx(
			{ prompt: "Fresh design fixture", max_refinements: 2 },
			{
				sessionFile: (name) => `/tmp/fresh-ocd-${name}.jsonl`,
				task: (name) => {
					if (name === "user-feedback-1") return previewWithAnnotations;
					if (name === "user-feedback-2") return "user_notes: none";
					return undefined;
				},
			},
		);

		const result = await d.run(ctx);
		assert.equal(ctx.calls.taskOptions["generate-2"]?.[0]?.context, "fresh");
		assert.equal(ctx.calls.taskOptions["user-feedback-2"]?.[0]?.context, "fresh");
		assert.match(ctx.calls.prompts["user-feedback-2"]?.[0] ?? "", /annotation_history/);
		assert.match(ctx.calls.prompts["generate-2"]?.[0] ?? "", /Keep the brand mark dominant/);
		const artifactDir = result.artifact_dir as string;
		const manifestPath = handoffLatestManifestPath(artifactDir);
		assert.equal(existsSync(manifestPath), true);
		const validated = validateHandoffManifest({ artifactRoot: artifactDir, manifestPath });
		assert.equal(validated.workflow, "open-claude-design");
		assert.ok(validated.contract.user_amendments.some((note) => note.includes("brand mark")));
		rmSync(artifactDir, { recursive: true, force: true });
	});
});
