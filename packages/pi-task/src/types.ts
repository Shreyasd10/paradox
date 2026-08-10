/**
 * Shared types for the pi-task extension.
 */

import type { ThinkingLevel, ThinkingPolicy } from "./config.ts";

export type TaskState = "queued" | "running" | "completed" | "failed" | "interrupted" | "timed_out";

export type ContextMode = "fresh" | "fork";

export type AgentScope = "user" | "project" | "both";

export type LimitReason = "turns" | "output";

export const CHILD_EXTENSION_CAPABILITIES = ["advisor"] as const;

export type ChildExtensionCapability = (typeof CHILD_EXTENSION_CAPABILITIES)[number];

/** Resolved per-invocation runtime policy persisted on the task record. */
export interface TaskPolicySnapshot {
	maxTurns: number;
	maxOutputTokens: number;
	maxOutputTokensPerRequest: number;
	thinking: ThinkingPolicy;
	resolvedThinking: ThinkingLevel;
	resultHeadBytes: number;
	resultTailBytes: number;
}

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

export interface TaskRecord {
	id: string;
	parentId: string | null;
	agent: string;
	agentSource: "user" | "project" | "unknown";
	/** Short (3–5 word) label for TUI; falls back to truncated task prompt. */
	description: string;
	contextMode: ContextMode;
	cwd: string;
	state: TaskState;
	background: boolean;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	sessionPath: string | null;
	resultPath: string | null;
	exitCode: number | null;
	output: string | null;
	error: string | null;
	truncated: boolean;
	usage: UsageStats;
	model: string | null;
	/** Optional — absent unless explicitly enabled for the child. */
	childExtensions?: ChildExtensionCapability[];
	/** Optional — absent on historical records. */
	policy?: TaskPolicySnapshot;
	limitReason?: LimitReason | null;
}

/** Live per-task activity for the TUI (in-memory only). */
export interface TaskActivity {
	activeTools: Map<string, string>;
	toolUses: number;
	responseText: string;
	turnCount: number;
}

export type WidgetMode = "all" | "background" | "off";

export function emptyActivity(): TaskActivity {
	return {
		activeTools: new Map(),
		toolUses: 0,
		responseText: "",
		turnCount: 0,
	};
}

/** Compact description for the widget from a task prompt. */
export function makeDescription(task: string, maxLen = 48): string {
	const line = task.split("\n").find((l) => l.trim())?.trim() ?? "task";
	if (line.length <= maxLen) return line;
	return `${line.slice(0, maxLen - 1)}…`;
}

export interface TaskResult {
	taskId: string;
	state: TaskState;
	output: string;
	error: string | null;
	sessionPath: string | null;
	exitCode: number;
	truncated: boolean;
	/** Optional — absent on historical results. */
	policy?: TaskPolicySnapshot;
	limitReason?: LimitReason | null;
}

export interface ChildRunOutput {
	exitCode: number;
	output: string;
	stderr: string;
	usage: UsageStats;
	model: string | null;
	interrupted: boolean;
	timedOut: boolean;
	truncated: boolean;
	/** Optional — set when a runtime budget stops the run. */
	limitReason?: LimitReason | null;
}

export function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

export function isTerminalState(state: TaskState): boolean {
	return state === "completed" || state === "failed" || state === "interrupted" || state === "timed_out";
}

export function isFailedState(state: TaskState): boolean {
	return state === "failed" || state === "interrupted" || state === "timed_out";
}

