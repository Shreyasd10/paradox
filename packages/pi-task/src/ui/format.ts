/**
 * Shared TUI formatting helpers — Grok Build tasks-pane parity
 * (xai-grok-pager views/tasks_pane.rs + glyphs + format_duration).
 */

import type { TaskActivity, TaskState, UsageStats } from "../types.ts";

export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

/** Grok tasks-pane / dashboard dot spinner (`⋅ : ⸬ ⁙`). */
export const SPINNER = ["⋅", ":", "⸬", "⁙", "⋅", ":", "⸬", "⁙"];

/** Grok braille frames (turn-status / title) — kept for callers that need them. */
export const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

export const ERROR_STATES = new Set<TaskState>(["failed", "interrupted", "timed_out"]);

/** Map Pi / lean-ctx tool names → Grok-style Running: subject. */
const GROK_TOOL_SUBJECT: Record<string, string> = {
	read: "Read",
	bash: "Run",
	edit: "Edit",
	write: "Write",
	grep: "Search",
	find: "Find",
	ls: "List",
	ctx_read: "Read",
	ctx_shell: "Run",
	ctx_search: "Search",
	ctx_glob: "Find",
	ctx_tree: "List",
	ctx_compose: "Compose",
	task: "Task",
};

export function fgPreservingNestedStyles(theme: Theme, color: string, text: string): string {
	const styledEmpty = theme.fg(color, "");
	const styleStart = styledEmpty.replace(/\u001b\[(?:0|39)m/g, "");
	return theme.fg(color, text.replace(/\u001b\[(?:0|39)m/g, (reset) => `${reset}${styleStart}`));
}

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

export function totalTokens(usage: UsageStats | undefined): number {
	if (!usage) return 0;
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * Grok `format_duration`: <10s → `1.7s`, <60s → `12s`, <1h → `1m5s`, else `1h2m`.
 */
export function formatMs(ms: number): string {
	if (ms < 0) ms = 0;
	const totalSecs = Math.floor(ms / 1000);
	if (totalSecs < 10) {
		return `${(ms / 1000).toFixed(1)}s`;
	}
	if (totalSecs < 60) {
		return `${totalSecs}s`;
	}
	const mins = Math.floor(totalSecs / 60);
	const secs = totalSecs % 60;
	if (mins < 60) {
		return `${mins}m${secs}s`;
	}
	const hours = Math.floor(mins / 60);
	const remainingMins = mins % 60;
	return `${hours}h${remainingMins}m`;
}

/** Screenshot-style bracketed elapsed / done marker. */
export function formatGrokElapsedBracket(ms: number, done = false): string {
	if (done) return `[✓]`;
	return `[${formatMs(ms)}]`;
}

export function formatFleetElapsed(ms: number): string {
	return formatMs(ms);
}

export function formatFleetTokens(count: number): string {
	let compact: string;
	if (count >= 1_000_000) compact = `${(count / 1_000_000).toFixed(1)}M`;
	else if (count >= 1_000) compact = `${(count / 1_000).toFixed(1)}k`;
	else compact = `${count}`;
	return `↓ ${compact} tokens`;
}

export function formatTurns(turnCount: number): string {
	return `↻${turnCount}`;
}

export function formatDuration(
	startedAtMs: number,
	completedAtMs?: number,
	state?: "queued" | "running" | string,
): string {
	if (completedAtMs) return formatMs(completedAtMs - startedAtMs);
	const label = state === "queued" ? "queued" : "running";
	return `${formatMs(Date.now() - startedAtMs)} (${label})`;
}

/**
 * Grok activity label (`format_activity_label`): `Thinking` / `Running: Read`.
 */
export function describeActivity(activity: TaskActivity | undefined): string {
	if (!activity) return "Thinking";
	if (activity.activeTools.size > 0) {
		const subjects = new Map<string, number>();
		for (const toolName of activity.activeTools.values()) {
			const subject = GROK_TOOL_SUBJECT[toolName] ?? toolName;
			subjects.set(subject, (subjects.get(subject) ?? 0) + 1);
		}
		const parts: string[] = [];
		for (const [subject, count] of subjects) {
			parts.push(count > 1 ? `${subject} ×${count}` : subject);
		}
		return `Running: ${parts.join(", ")}`;
	}
	if (activity.responseText.trim()) {
		const line = activity.responseText.split("\n").find((l) => l.trim())?.trim() ?? "";
		if (line.length > 60) return `${line.slice(0, 60)}…`;
		if (line) return "Responding";
	}
	return "Thinking";
}

export function statusIcon(state: TaskState, theme: Theme, spinnerFrame?: string): string {
	switch (state) {
		case "running":
			return theme.fg("accent", spinnerFrame ?? "⋅");
		case "queued":
			return theme.fg("muted", "◦");
		case "completed":
			return theme.fg("success", "✓");
		case "failed":
			return theme.fg("error", "✗");
		case "interrupted":
			return theme.fg("dim", "■");
		case "timed_out":
			return theme.fg("error", "✗");
		default:
			return theme.fg("dim", "○");
	}
}

export function statusLabel(state: TaskState): string {
	switch (state) {
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "interrupted":
			return "stopped";
		case "timed_out":
			return "timed out";
		case "running":
			return "running";
		case "queued":
			return "queued";
		default:
			return state;
	}
}

/** Agent type label color — Grok tasks_pane state-driven hues. */
export function agentTypeColor(state: TaskState): string {
	switch (state) {
		case "running":
			return "accent";
		case "queued":
			return "muted";
		case "completed":
			return "success";
		case "failed":
		case "timed_out":
			return "error";
		case "interrupted":
			return "dim";
		default:
			return "muted";
	}
}
