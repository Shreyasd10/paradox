import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Type, type Static } from "typebox";
import type { WorkflowRunContext, WorkflowTaskResult } from "../../src/shared/types.js";
import { workflowArtifactRunPath } from "../../src/shared/workflow-artifacts.js";
import {
	ITERATION_CONTEXT_FORK,
	iterationContinuationOptions,
	parseIterationContext,
	resolveHandoffPolicy,
	type IterationContextMode,
} from "../../builtin/iteration-context.js";
import {
	buildHandoffManifest,
	handoffLatestManifestPath,
	snapshotEvidenceRef,
	validateHandoffManifest,
	writeHandoffManifest,
} from "../../builtin/iteration-handoff.js";
import { agentRoot, assertAllWorkflowAssets, templateRoot, verbatimSkill } from "./asset-loader.js";
import { assertPiTaskPrerequisites, PI_TASK_STAGE_TOOLS, piTaskExecutionPolicy } from "./pi-task-policy.js";
import { resolveDeliveryRunPolicy } from "./run-policy.js";
import type { SkillStageSpec } from "./stage-graph.js";

export type DeliveryWorkflowInputs = {
	task: string;
	include_research?: boolean;
	detailed_plan?: boolean;
	iteration_context?: "fresh" | "fork";
};

export type DeliveryWorkflowOutputs = {
	status: "completed" | "blocked";
	completed_stages: string[];
	reason?: string;
};

const turnOutcomeSchema = Type.Object(
	{
		kind: Type.Union([
			Type.Literal("question"),
			Type.Literal("approval_required"),
			Type.Literal("stage_complete"),
			Type.Literal("blocked"),
		]),
		message: Type.String(),
		question_id: Type.Optional(Type.String()),
		gate: Type.Optional(Type.String()),
		artifact_paths: Type.Array(Type.String()),
		diagnostics: Type.Array(Type.String()),
	},
	{ additionalProperties: false },
);

type TurnOutcome = Static<typeof turnOutcomeSchema>;

const MAX_STAGE_TURNS = 32;
const MAX_ACTIVE_ANSWER_BYTES = 32 * 1024;

export class DeliveryWorkflowBlocked extends Error {}

export type DeliveryHost = {
	ctx: WorkflowRunContext<DeliveryWorkflowInputs, DeliveryWorkflowOutputs>;
	cwd: string;
	task: string;
	workflow: "rpi" | "prd-oriented";
	iterationContext: IterationContextMode;
	artifactRoot: string;
	completedStages: string[];
};

export async function createDeliveryHost(
	ctx: WorkflowRunContext<DeliveryWorkflowInputs, DeliveryWorkflowOutputs>,
	workflow: DeliveryHost["workflow"],
): Promise<DeliveryHost> {
	const cwd = ctx.cwd ?? process.cwd();
	const artifactRoot = workflowArtifactRunPath(ctx.runId ?? `${workflow}-${Date.now()}`);
	await mkdir(artifactRoot, { recursive: true });
	const policy = await resolveHandoffPolicy({
		artifactDir: artifactRoot,
		requested: parseIterationContext(ctx.inputs.iteration_context),
	});
	assertAllWorkflowAssets();
	await resolveDeliveryRunPolicy({
		artifactRoot,
		workflow,
		iterationContext: policy.iteration_context,
		cwd,
		maxSkillTurns: MAX_STAGE_TURNS,
		maxActiveAnswerBytes: MAX_ACTIVE_ANSWER_BYTES,
	});
	return {
		ctx,
		cwd,
		task: String(ctx.inputs.task),
		workflow,
		iterationContext: policy.iteration_context,
		artifactRoot,
		completedStages: [],
	};
}

export function buildVerbatimSkillPrompt(args: {
	host: DeliveryHost;
	stage: SkillStageSpec;
	turn: number;
	answer?: string;
	handoff?: string;
}): string {
	const skill = verbatimSkill(args.stage.skill);
	return [
		piTaskExecutionPolicy(args.host.cwd),
		"WORKFLOW TURN CONTRACT:",
		`- Logical stage: ${args.stage.label} (${args.stage.id}); physical turn: ${args.turn}.`,
		`- Work only in ${args.host.cwd}. Do not create/switch worktrees or branches; do not commit, push, or open a pull request.`,
		`- Original immutable task contract:\n---\n${args.host.task}\n---`,
		`- Templates are rooted at ${templateRoot}; canonical named-agent contracts are rooted at ${agentRoot}.`,
		`- Stage scope: ${args.stage.instructions}`,
		args.handoff === undefined ? "- This is the first turn for this logical stage." : `- Validate and use the handoff at ${args.handoff}.`,
		args.answer === undefined ? "- There is no new human answer on this turn." : `- Latest human answer (verbatim):\n---\n${args.answer}\n---`,
		"- Execute the immutable skill faithfully. When it requires waiting for the human, stop after exactly one question and return kind=question.",
		"- For a skill-defined intermediate review (including each implementation phase), return kind=approval_required before advancing.",
		"- Return kind=stage_complete only when the entire skill stage is ready for the host's final human review.",
		"- artifact_paths must name every authoritative artifact created or updated this turn. Use paths relative to cwd or absolute paths.",
		"IMMUTABLE VERBATIM SKILL PAYLOAD — BEGIN",
		skill,
		"IMMUTABLE VERBATIM SKILL PAYLOAD — END",
	].join("\n\n");
}

function structuredOutcome(result: WorkflowTaskResult, stage: SkillStageSpec): TurnOutcome {
	const outcome = result.structured as TurnOutcome | undefined;
	if (outcome === undefined || !Array.isArray(outcome.artifact_paths)) {
		throw new DeliveryWorkflowBlocked(`${stage.label} did not return the required structured turn outcome`);
	}
	if (outcome.kind === "question" && (outcome.question_id === undefined || outcome.question_id.length === 0)) {
		throw new DeliveryWorkflowBlocked(`${stage.label} returned a question without a stable question_id`);
	}
	if (outcome.kind === "approval_required" && (outcome.gate === undefined || outcome.gate.length === 0)) {
		throw new DeliveryWorkflowBlocked(`${stage.label} returned an approval request without a gate id`);
	}
	return outcome;
}

function artifactPath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

async function recordTurn(
	host: DeliveryHost,
	stage: SkillStageSpec,
	stageRoot: string,
	turn: number,
	outcome: TurnOutcome,
	answer?: string,
): Promise<string> {
	const receiptPath = resolve(stageRoot, `turn-${turn}.json`);
	await writeFile(receiptPath, `${JSON.stringify({ turn, outcome, answer }, null, 2)}\n`, "utf8");
	const evidence = [
		snapshotEvidenceRef({ artifactRoot: stageRoot, path: receiptPath, role: "turn_receipt", iteration: turn }),
	];
	for (const [index, path] of outcome.artifact_paths.entries()) {
		evidence.push(
			snapshotEvidenceRef({
				artifactRoot: stageRoot,
				path: artifactPath(host.cwd, path),
				role: `authoritative_artifact_${index + 1}`,
				iteration: turn,
			}),
		);
	}
	return writeHandoffManifest({
		artifactRoot: stageRoot,
		manifest: buildHandoffManifest({
			workflow: host.workflow,
			iteration: turn,
			iterationContext: host.iterationContext,
			objective: host.task,
			acceptanceCriteria: host.task,
			approved: false,
			status: outcome.kind,
			nextAction: outcome.kind,
			diagnostics: outcome.diagnostics,
			evidence,
		}),
	});
}

async function humanInput(host: DeliveryHost, message: string): Promise<string> {
	const answer = await host.ctx.ui.input(message);
	if (Buffer.byteLength(answer, "utf8") > MAX_ACTIVE_ANSWER_BYTES) {
		throw new DeliveryWorkflowBlocked(`Human answer exceeds ${MAX_ACTIVE_ANSWER_BYTES} byte active-dialogue budget`);
	}
	return answer;
}

async function recordStageApproval(
	host: DeliveryHost,
	stage: SkillStageSpec,
	stageRoot: string,
	turn: number,
	latestHandoff: string,
): Promise<void> {
	const approvalPath = resolve(stageRoot, "stage-approval.json");
	await writeFile(
		approvalPath,
		`${JSON.stringify({ stage: stage.id, approved: true, approved_at: new Date().toISOString() }, null, 2)}\n`,
		"utf8",
	);
	const evidence = [
		snapshotEvidenceRef({
			artifactRoot: stageRoot,
			path: latestHandoff,
			role: "pre_approval_handoff",
			iteration: turn,
		}),
		snapshotEvidenceRef({
			artifactRoot: stageRoot,
			path: approvalPath,
			role: "human_stage_approval",
			iteration: turn,
		}),
	];
	writeHandoffManifest({
		artifactRoot: stageRoot,
		manifest: buildHandoffManifest({
			workflow: host.workflow,
			iteration: turn,
			iterationContext: host.iterationContext,
			objective: host.task,
			acceptanceCriteria: host.task,
			approved: true,
			status: "stage_approved",
			nextAction: "next_stage",
			evidence,
		}),
	});
}

export async function runVerbatimSkillStage(host: DeliveryHost, stage: SkillStageSpec): Promise<void> {
	const stageRoot = resolve(host.artifactRoot, "skill-stages", stage.id);
	await mkdir(stageRoot, { recursive: true });
	let previousSessionFile: string | undefined;
	let latestHandoff: string | undefined;
	let answer: string | undefined;

	for (let turn = 1; turn <= MAX_STAGE_TURNS; turn += 1) {
		if (turn > 1 && host.iterationContext !== ITERATION_CONTEXT_FORK) {
			latestHandoff ??= handoffLatestManifestPath(stageRoot);
			validateHandoffManifest({ artifactRoot: stageRoot, manifestPath: latestHandoff });
		}
		const continuation = iterationContinuationOptions(host.iterationContext, previousSessionFile);
		const result = await host.ctx.task(`${stage.id}:turn-${turn}`, {
			prompt: buildVerbatimSkillPrompt({
				host,
				stage,
				turn,
				answer,
				handoff: host.iterationContext === ITERATION_CONTEXT_FORK ? undefined : latestHandoff,
			}),
			schema: turnOutcomeSchema,
			cwd: host.cwd,
			tools: PI_TASK_STAGE_TOOLS,
			context: continuation.context,
			...(continuation.context === "fork" ? { forkFromSessionFile: continuation.forkFromSessionFile } : {}),
			...(stage.model === undefined ? {} : { model: stage.model }),
		});
		previousSessionFile = result.sessionFile;
		const outcome = structuredOutcome(result, stage);
		latestHandoff = await recordTurn(host, stage, stageRoot, turn, outcome, answer);

		if (outcome.kind === "blocked") throw new DeliveryWorkflowBlocked(outcome.message);
		if (outcome.kind === "question") {
			answer = await humanInput(host, outcome.message);
			continue;
		}
		if (outcome.kind === "approval_required") {
			const approved = await host.ctx.ui.confirm(`${stage.label}: ${outcome.message}`);
			answer = approved ? "APPROVED" : `CHANGES REQUESTED: ${await humanInput(host, "What should change before approval?")}`;
			continue;
		}

		if (await host.ctx.ui.confirm(`Review and approve the completed ${stage.label} stage.`)) {
			await recordStageApproval(host, stage, stageRoot, turn, latestHandoff);
			host.completedStages.push(stage.skill);
			return;
		}
		answer = `STAGE CHANGES REQUESTED: ${await humanInput(host, `What should change in ${stage.label}?`)}`;
	}

	throw new DeliveryWorkflowBlocked(`${stage.label} exceeded ${MAX_STAGE_TURNS} bounded turns`);
}

export async function runDeliveryGraph(host: DeliveryHost, stages: readonly SkillStageSpec[]): Promise<DeliveryWorkflowOutputs> {
	try {
		try {
			assertPiTaskPrerequisites();
		} catch (error) {
			throw new DeliveryWorkflowBlocked(error instanceof Error ? error.message : String(error));
		}
		for (const stage of stages) await runVerbatimSkillStage(host, stage);
		return { status: "completed", completed_stages: host.completedStages };
	} catch (error) {
		if (!(error instanceof DeliveryWorkflowBlocked)) throw error;
		return { status: "blocked", completed_stages: host.completedStages, reason: error.message };
	}
}
