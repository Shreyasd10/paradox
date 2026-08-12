import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IterationContextMode } from "../../builtin/iteration-context.js";
import { assetLockSha256 } from "./asset-loader.js";
import { REQUIRED_PI_TASK_AGENTS } from "./pi-task-policy.js";

const RUN_POLICY_SCHEMA_VERSION = 1;
const GRAPH_VERSION = 1;
const DELEGATION_POLICY_VERSION = 1;

type DeliveryRunPolicy = {
	schema_version: number;
	graph_version: number;
	workflow: "rpi" | "prd-oriented";
	iteration_context: IterationContextMode;
	workflow_cwd: string;
	asset_lock_sha256: string;
	delegation_policy_version: number;
	allowed_agents: readonly string[];
	max_skill_turns: number;
	max_active_answer_bytes: number;
};

function policyPath(artifactRoot: string): string {
	return resolve(artifactRoot, "delivery-run-policy.json");
}

function samePolicy(left: DeliveryRunPolicy, right: DeliveryRunPolicy): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export async function resolveDeliveryRunPolicy(args: {
	artifactRoot: string;
	workflow: DeliveryRunPolicy["workflow"];
	iterationContext: IterationContextMode;
	cwd: string;
	maxSkillTurns: number;
	maxActiveAnswerBytes: number;
}): Promise<DeliveryRunPolicy> {
	const expected: DeliveryRunPolicy = {
		schema_version: RUN_POLICY_SCHEMA_VERSION,
		graph_version: GRAPH_VERSION,
		workflow: args.workflow,
		iteration_context: args.iterationContext,
		workflow_cwd: resolve(args.cwd),
		asset_lock_sha256: assetLockSha256(),
		delegation_policy_version: DELEGATION_POLICY_VERSION,
		allowed_agents: REQUIRED_PI_TASK_AGENTS,
		max_skill_turns: args.maxSkillTurns,
		max_active_answer_bytes: args.maxActiveAnswerBytes,
	};
	const path = policyPath(args.artifactRoot);
	if (existsSync(path)) {
		const stored = JSON.parse(await readFile(path, "utf8")) as DeliveryRunPolicy;
		if (!samePolicy(stored, expected)) {
			throw new Error(`Delivery run policy mismatch on resume: ${path}`);
		}
		return stored;
	}
	await writeFile(path, `${JSON.stringify(expected, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
	return expected;
}
