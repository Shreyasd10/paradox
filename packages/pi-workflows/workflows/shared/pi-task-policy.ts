import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getHostAgentDir } from "../../src/shared/host-paths.js";
import { lockedAsset } from "./asset-loader.js";

export const REQUIRED_PI_TASK_AGENTS = [
	"codebase-locator",
	"codebase-analyzer",
	"codebase-pattern-finder",
	"web-search-researcher",
	"implementer",
	"codebase-mapper",
	"repo-profiler",
	"workspace-locator",
] as const;

export const PI_TASK_STAGE_TOOLS = ["read", "bash", "edit", "write", "find", "search", "task"] as const;

function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function assertPiTaskPrerequisites(agentDir = getHostAgentDir()): void {
	const settingsPath = resolve(agentDir, "settings.json");
	if (!existsSync(settingsPath)) throw new Error(`pi-task prerequisite missing: ${settingsPath}`);
	const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown[] };
	const configured = (settings.packages ?? []).some((entry) =>
		(typeof entry === "string" ? entry : JSON.stringify(entry)).toLowerCase().includes("pi-task"),
	);
	if (!configured) throw new Error("pi-task prerequisite missing: install @shreyasdevadiga/pi-task");

	for (const name of REQUIRED_PI_TASK_AGENTS) {
		const installedPath = resolve(agentDir, "agents", `${name}.md`);
		if (!existsSync(installedPath)) {
			throw new Error(`pi-task named-agent prerequisite missing: ${installedPath}`);
		}
		const installed = readFileSync(installedPath);
		const expected = lockedAsset(`agents/${name}.md`);
		if (sha256(installed) !== sha256(expected)) {
			throw new Error(`pi-task named-agent contract differs from the locked workflow asset: ${name}`);
		}
	}
}

export function piTaskExecutionPolicy(cwd: string): string {
	return [
		"HOST EXECUTION POLICY (higher priority than legacy transport vocabulary in the immutable skill payload):",
		"- For every delegated specialist, call only the installed pi-task `task` tool.",
		`- Every call must use cwd=${JSON.stringify(cwd)}, context=\"fresh\", background=false, and agent_scope=\"user\".`,
		"- Use the exact named agent requested by the skill. Agent(), Agent tool, subagent, subagent_type, and inline specialist fallback are legacy vocabulary; translate them to pi-task.",
		"- Set max_turns by work size: locator 8–10; targeted analysis 12–16; broad research 16–24; implementation/review 24–32.",
		"- If the task tool or named agent is unavailable, return blocked. Never substitute another delegation mechanism.",
		"- Do not call ask_user_question. Return one question through the required structured outcome; the host owns all human interaction.",
	].join("\n");
}
