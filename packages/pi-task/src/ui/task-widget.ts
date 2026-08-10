/**
 * Above-editor task widget — Grok Build tasks-pane flat rows
 * (xai-grok-pager views/tasks_pane.rs) + kill/open actions.
 */

import {
	Editor,
	isKeyRelease,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { TaskView } from "../activity.ts";
import { roster } from "../activity.ts";
import type { TaskState, WidgetMode } from "../types.ts";
import {
	agentTypeColor,
	describeActivity,
	ERROR_STATES,
	formatGrokElapsedBracket,
	SPINNER,
	statusIcon,
	type Theme,
} from "./format.ts";

const MAX_WIDGET_LINES = 12;
const ERROR_LINGER_TURNS = 2;
const ACTIVITY_DESC_MAX = 40;

export type WidgetActions = {
	onStop(taskId: string): boolean;
	onOpen(view: TaskView): void;
	notify?(message: string, type?: "info" | "warning" | "error"): void;
};

export type UICtx = {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| undefined
			| ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
	onTerminalInput?(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void;
	getEditorText?(): string;
};

function rightAlign(left: string, right: string, width: number): string {
	const rightW = visibleWidth(right);
	const maxLeft = Math.max(0, width - rightW - 1);
	const leftClamped = truncateToWidth(left, maxLeft);
	const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW);
	return truncateToWidth(leftClamped + " ".repeat(gap) + right, width);
}

function truncatePlain(text: string, max: number): string {
	if (text.length <= max) return text;
	if (max <= 1) return "…";
	return `${text.slice(0, max - 1)}…`;
}

export class TaskWidget {
	private uiCtx: UICtx | undefined;
	private widgetFrame = 0;
	private widgetInterval: ReturnType<typeof setInterval> | undefined;
	private finishedTurnAge = new Map<string, number>();
	private widgetRegistered = false;
	private tui: any | undefined;
	private lastStatusText: string | undefined;
	private unsub: (() => void) | undefined;
	private inputUnsub: (() => void) | undefined;
	private mode: () => WidgetMode;
	private actions: WidgetActions | undefined;
	private active = false;
	private selectedIndex = 0;
	private pendingKillId: string | undefined;

	constructor(mode: () => WidgetMode = () => "background") {
		this.mode = mode;
		this.unsub = roster.subscribe(() => this.update());
	}

	setActions(actions: WidgetActions): void {
		this.actions = actions;
	}

	private actionableViews(): TaskView[] {
		return this.visibleViews().filter(
			(v) =>
				v.record.state === "running" ||
				v.record.state === "queued" ||
				(v.completedAtMs != null &&
					this.shouldShowFinished(v.record.id, v.record.state)),
		);
	}

	private visibleViews(): TaskView[] {
		const all = roster.list();
		switch (this.mode()) {
			case "off":
				return [];
			case "background":
				return all.filter((v) => v.record.background !== false);
			default:
				return all;
		}
	}

	setUICtx(ctx: UICtx): void {
		if (ctx !== this.uiCtx) {
			this.inputUnsub?.();
			this.inputUnsub = undefined;
			this.uiCtx = ctx;
			this.widgetRegistered = false;
			this.tui = undefined;
			this.lastStatusText = undefined;
			this.active = false;
			if (ctx.onTerminalInput) {
				this.inputUnsub = ctx.onTerminalInput((data) => this.handleKey(data));
			}
		}
	}

	onTurnStart(): void {
		for (const [id, age] of this.finishedTurnAge) {
			this.finishedTurnAge.set(id, age + 1);
		}
		this.update();
	}

	ensureTimer(): void {
		if (!this.widgetInterval) {
			this.widgetInterval = setInterval(() => this.update(), 80);
		}
	}

	markFinished(taskId: string): void {
		if (!this.finishedTurnAge.has(taskId)) {
			this.finishedTurnAge.set(taskId, 0);
		}
	}

	private shouldShowFinished(taskId: string, state: TaskState): boolean {
		const age = this.finishedTurnAge.get(taskId) ?? 0;
		const maxAge = ERROR_STATES.has(state) ? ERROR_LINGER_TURNS : 1;
		return age < maxAge;
	}

	private editorHasFocus(): boolean {
		const focused = (this.tui as { focusedComponent?: unknown } | undefined)?.focusedComponent;
		return focused == null || focused instanceof Editor;
	}

	private handleKey(data: string): { consume?: boolean; data?: string } | undefined {
		if (!this.uiCtx || !this.actions) return undefined;
		if (isKeyRelease(data)) return undefined;
		if (!this.editorHasFocus()) {
			if (this.active) this.deactivate();
			return undefined;
		}

		const rows = this.actionableViews();
		if (rows.length === 0) {
			if (this.active) this.deactivate();
			return undefined;
		}

		// Ctrl+T — focus task strip (Grok-like manage without stealing ↓ from FleetView)
		if (matchesKey(data, Key.ctrl("t"))) {
			if (this.uiCtx.getEditorText?.() !== "") return undefined;
			this.active = true;
			this.selectedIndex = 0;
			this.pendingKillId = undefined;
			this.update();
			this.actions.notify?.("Tasks focused — ↑↓ select · enter open · x stop · esc", "info");
			return { consume: true };
		}

		if (!this.active) return undefined;

		if (matchesKey(data, "down")) {
			this.selectedIndex = Math.min(rows.length - 1, this.selectedIndex + 1);
			this.pendingKillId = undefined;
			this.update();
			return { consume: true };
		}
		if (matchesKey(data, "up")) {
			if (this.selectedIndex <= 0) {
				this.deactivate();
				return { consume: true };
			}
			this.selectedIndex -= 1;
			this.pendingKillId = undefined;
			this.update();
			return { consume: true };
		}
		if (matchesKey(data, "escape")) {
			this.deactivate();
			return { consume: true };
		}
		if (matchesKey(data, Key.enter)) {
			const view = rows[this.selectedIndex];
			if (view) {
				this.actions.onOpen(view);
				this.deactivate();
			}
			return { consume: true };
		}
		if (data === "x" || data === "X") {
			const view = rows[this.selectedIndex];
			if (!view || (view.record.state !== "running" && view.record.state !== "queued")) {
				this.actions.notify?.("Task is not running.", "info");
				return { consume: true };
			}
			if (this.pendingKillId !== view.record.id) {
				this.pendingKillId = view.record.id;
				this.actions.notify?.(`Press x again to stop "${view.record.description}".`, "warning");
				this.update();
				return { consume: true };
			}
			if (this.actions.onStop(view.record.id)) {
				this.actions.notify?.(`Stopped "${view.record.description}".`, "info");
			}
			this.pendingKillId = undefined;
			this.update();
			return { consume: true };
		}

		this.deactivate();
		return undefined;
	}

	private deactivate(): void {
		this.active = false;
		this.selectedIndex = 0;
		this.pendingKillId = undefined;
		this.update();
	}

	/**
	 * Flat Grok row with action affordances:
	 * `▌⋅ code-reviewer  desc — Thinking              [↗] [✗] [1.7s]`
	 */
	private renderTaskRow(
		view: TaskView,
		width: number,
		theme: Theme,
		frame: string,
		rowIndex: number,
	): string {
		const { record, activity, startedAtMs, completedAtMs } = view;
		const elapsedMs = (completedAtMs ?? Date.now()) - startedAtMs;
		const running = record.state === "running";
		const queued = record.state === "queued";
		const done = record.state === "completed";
		const selected = this.active && rowIndex === this.selectedIndex;
		const icon = statusIcon(record.state, theme, running ? frame : undefined);
		const typeLabel = theme.fg(agentTypeColor(record.state), record.agent);

		const activityText = running ? describeActivity(activity) : "";
		let desc = record.description;
		if (activityText) desc = truncatePlain(desc, ACTIVITY_DESC_MAX);
		const descPart = running ? theme.fg("muted", desc) : theme.fg("dim", desc);

		const sel = selected ? theme.fg("accent", "▌") : " ";
		const leftParts = [`${sel}${icon} ${typeLabel}  ${descPart}`];
		if (activityText) leftParts.push(theme.fg("dim", ` — ${activityText}`));
		if (record.state === "failed" && record.error) {
			leftParts.push(theme.fg("error", ` ${record.error.slice(0, 40)}`));
		} else if (record.state === "interrupted") {
			leftParts.push(theme.fg("dim", " stopped"));
		} else if (record.state === "timed_out") {
			leftParts.push(theme.fg("warning", " timed out"));
		}

		const killPending = this.pendingKillId === record.id;
		const actions =
			running || queued
				? theme.fg(selected ? "accent" : "dim", "[↗]") +
					" " +
					theme.fg(killPending ? "error" : selected ? "accent" : "dim", "[✗]") +
					" "
				: theme.fg(selected ? "accent" : "dim", "[↗]") + " ";
		const right =
			actions + theme.fg("dim", formatGrokElapsedBracket(elapsedMs, done));
		return rightAlign(leftParts.join(""), right, width);
	}

	private renderWidget(tui: any, theme: Theme): string[] {
		const all = this.visibleViews();
		const running = all.filter((v) => v.record.state === "running");
		const queued = all.filter((v) => v.record.state === "queued");
		const finished = all.filter(
			(v) =>
				v.record.state !== "running" &&
				v.record.state !== "queued" &&
				v.completedAtMs &&
				this.shouldShowFinished(v.record.id, v.record.state),
		);

		if (running.length === 0 && queued.length === 0 && finished.length === 0) return [];

		const w = tui.terminal.columns as number;
		const frame = SPINNER[this.widgetFrame % SPINNER.length];
		const rows: string[] = [];

		const ordered: TaskView[] = [
			...running.slice().sort((a, b) => b.startedAtMs - a.startedAtMs),
			...finished.slice().sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0)),
			...queued,
		];

		// Keep selection in range for actionable list (same order)
		if (this.active) {
			const max = Math.max(0, ordered.length - 1);
			if (this.selectedIndex > max) this.selectedIndex = max;
		}

		const maxBody = MAX_WIDGET_LINES - (this.active ? 1 : 0);
		let hidden = 0;
		let rowIndex = 0;
		for (const v of ordered) {
			if (rows.length >= maxBody) {
				hidden++;
				rowIndex++;
				continue;
			}
			rows.push(this.renderTaskRow(v, w, theme, frame, rowIndex));
			rowIndex++;
		}

		if (hidden > 0) {
			rows.push(rightAlign("", theme.fg("dim", `+${hidden} more`), w));
		}

		if (this.active) {
			rows.push(
				truncateToWidth(
					theme.fg("dim", "↑↓ select · enter open · x stop · esc · Ctrl+T focus"),
					w,
				),
			);
		}

		return rows;
	}

	update(): void {
		if (!this.uiCtx) return;
		// Fleet strip above the editor is the sole subagent UI.
		if (this.widgetRegistered) {
			this.uiCtx.setWidget("pi-tasks", undefined);
			this.widgetRegistered = false;
			this.tui = undefined;
		}
		if (this.lastStatusText !== undefined) {
			this.uiCtx.setStatus("pi-tasks", undefined);
			this.lastStatusText = undefined;
		}
		if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}
		this.active = false;
	}

	dispose(): void {
		this.unsub?.();
		this.unsub = undefined;
		this.inputUnsub?.();
		this.inputUnsub = undefined;
		if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}
		if (this.uiCtx) {
			this.uiCtx.setWidget("pi-tasks", undefined);
			this.uiCtx.setStatus("pi-tasks", undefined);
		}
		this.widgetRegistered = false;
		this.tui = undefined;
		this.lastStatusText = undefined;
		this.active = false;
		this.actions = undefined;
	}
}
