import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { discoverStartupWorkflowsSync } from "../src/extension/discovery.js";
import { assertAllWorkflowAssets, lockedAsset, lockedAssetEntries, verbatimSkill } from "../workflows/shared/asset-loader.js";
import {
	assertPiTaskPrerequisites,
	piTaskExecutionPolicy,
	REQUIRED_PI_TASK_AGENTS,
} from "../workflows/shared/pi-task-policy.js";
import { rpiGraph } from "../workflows/rpi/graph.js";
import { prdOrientedGraph } from "../workflows/prd-oriented/graph.js";
import { resolveDeliveryRunPolicy } from "../workflows/shared/run-policy.js";
import {
	buildVerbatimSkillPrompt,
	runVerbatimSkillStage,
	type DeliveryHost,
} from "../workflows/shared/verbatim-skill-runner.js";

describe("custom delivery workflows", () => {
	test("registers RPI and PRD-Oriented in the live bundled startup catalog", () => {
		const result = discoverStartupWorkflowsSync();
		assert.equal(result.registry.names().length, 11);
		const executableBundle = readFileSync(join(process.cwd(), "src/extension/index.bundle.mjs"), "utf8");
		assert.match(executableBundle, /name: "RPI"/);
		assert.match(executableBundle, /name: "PRD-Oriented"/);

		for (const name of ["rpi", "prd-oriented"]) {
			const definition = result.registry.get(name);
			assert.ok(definition);
			assert.deepEqual(Object.keys(definition.inputs), [
				"task",
				"include_research",
				"detailed_plan",
				"iteration_context",
			]);
		}
	});

	test("locks every vendored asset and injects the complete skill exactly once", () => {
		assert.doesNotThrow(() => assertAllWorkflowAssets());
		assert.equal(lockedAssetEntries().length, 73);
		const stage = rpiGraph(false, false)[0]!;
		const skill = verbatimSkill(stage.skill);
		const host = {
			cwd: "/tmp/project",
			task: "Ship the requested change",
			workflow: "rpi",
		} as DeliveryHost;
		const prompt = buildVerbatimSkillPrompt({ host, stage, turn: 1 });
		assert.equal(prompt.split(skill).length - 1, 1);
		assert.match(prompt, /call only the installed pi-task `task` tool/);
		assert.match(prompt, /Agent\(\).*legacy vocabulary/);
	});

	test("gives research-question specialists enough turns and resumes capped work", () => {
		const skill = verbatimSkill("create-research-questions");
		assert.match(skill, /Use 24 turns for codebase-locator, codebase-analyzer, and codebase-pattern-finder/);
		assert.match(skill, /resume that same task once with its `task_id`, `max_turns: 12`/);
		assert.match(skill, /Do not discard its work by starting a fresh replacement search/);
	});

	test("builds first-class graphs with reviewable optional paths", () => {
		assert.deepEqual(rpiGraph(false, false).map((stage) => stage.skill), [
			"create-design-discussion",
			"create-structure-outline",
			"implement-outline",
		]);
		assert.deepEqual(prdOrientedGraph(true, true).map((stage) => stage.skill), [
			"create-research-questions",
			"create-research",
			"create-prd",
			"create-technical-design",
			"create-structure-outline",
			"create-plan",
			"implement-plan",
		]);
	});

	test("fails closed unless pi-task and exact named-agent contracts are installed", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-task-prereq-"));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["pi-task"] }));
		mkdirSync(join(agentDir, "agents"));
		assert.throws(() => assertPiTaskPrerequisites(agentDir), /named-agent prerequisite missing/);
		for (const name of REQUIRED_PI_TASK_AGENTS) {
			writeFileSync(join(agentDir, "agents", `${name}.md`), lockedAsset(`agents/${name}.md`));
		}
		assert.doesNotThrow(() => assertPiTaskPrerequisites(agentDir));
		assert.match(piTaskExecutionPolicy("/tmp/project"), /background=false/);
	});

	test("uses fresh physical sessions and a validated handoff across human turns", async () => {
		const root = mkdtempSync(join(tmpdir(), "verbatim-stage-"));
		const taskOptions: Array<Record<string, unknown>> = [];
		let call = 0;
		const ctx = {
			task: async (_name: string, options: Record<string, unknown>) => {
				taskOptions.push(options);
				call += 1;
				return call === 1
					? {
							structured: {
								kind: "question",
								message: "Which option should we use?",
								question_id: "design-1",
								artifact_paths: [],
								diagnostics: [],
							},
							sessionFile: "/tmp/session-1.jsonl",
						}
					: {
							structured: {
								kind: "stage_complete",
								message: "Design is ready.",
								artifact_paths: [],
								diagnostics: [],
							},
							sessionFile: "/tmp/session-2.jsonl",
						};
			},
			ui: {
				input: async () => "Use option A",
				confirm: async () => true,
			},
		};
		const host = {
			ctx,
			cwd: root,
			task: "Design the change",
			workflow: "rpi",
			iterationContext: "fresh",
			artifactRoot: root,
			completedStages: [],
		} as unknown as DeliveryHost;

		await runVerbatimSkillStage(host, rpiGraph(false, false)[0]!);

		assert.equal(taskOptions.length, 2);
		assert.equal(taskOptions[0]!.context, "fresh");
		assert.equal(taskOptions[1]!.context, "fresh");
		assert.equal("forkFromSessionFile" in taskOptions[1]!, false);
		assert.match(String(taskOptions[1]!.prompt), /Use option A/);
		assert.match(String(taskOptions[1]!.prompt), /handoff-latest\.json/);
		assert.deepEqual(host.completedStages, ["create-design-discussion"]);
		const approvedHandoff = JSON.parse(
			readFileSync(join(root, "skill-stages/design-discussion/handoff-latest.json"), "utf8"),
		) as { validation: { approved: boolean } };
		assert.equal(approvedHandoff.validation.approved, true);
	});

	test("fork rollback continues only the matching logical-stage session", async () => {
		const root = mkdtempSync(join(tmpdir(), "forked-stage-"));
		const taskOptions: Array<Record<string, unknown>> = [];
		let call = 0;
		const host = {
			ctx: {
				task: async (_name: string, options: Record<string, unknown>) => {
					taskOptions.push(options);
					call += 1;
					return {
						structured: {
							kind: call === 1 ? "question" : "stage_complete",
							message: call === 1 ? "Continue?" : "Ready",
							question_id: call === 1 ? "continue-1" : undefined,
							artifact_paths: [],
							diagnostics: [],
						},
						sessionFile: `/tmp/fork-${call}.jsonl`,
					};
				},
				ui: { input: async () => "Continue", confirm: async () => true },
			},
			cwd: root,
			task: "Design the change",
			workflow: "rpi",
			iterationContext: "fork",
			artifactRoot: root,
			completedStages: [],
		} as unknown as DeliveryHost;

		await runVerbatimSkillStage(host, rpiGraph(false, false)[0]!);

		assert.equal(taskOptions[0]!.context, "fresh");
		assert.equal(taskOptions[1]!.context, "fork");
		assert.equal(taskOptions[1]!.forkFromSessionFile, "/tmp/fork-1.jsonl");
	});

	test("persists the delivery graph policy and rejects resume drift", async () => {
		const artifactRoot = mkdtempSync(join(tmpdir(), "delivery-policy-"));
		const base = {
			artifactRoot,
			workflow: "rpi" as const,
			iterationContext: "fresh" as const,
			cwd: "/tmp/project",
			maxSkillTurns: 32,
			maxActiveAnswerBytes: 32 * 1024,
		};
		await resolveDeliveryRunPolicy(base);
		await assert.rejects(
			resolveDeliveryRunPolicy({ ...base, iterationContext: "fork" }),
			/run policy mismatch/i,
		);
	});
});
