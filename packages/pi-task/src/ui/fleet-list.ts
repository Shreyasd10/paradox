/**
 * Below-editor FleetView — navigable list of main + running tasks.
 * Adapted from tintinweb fleet-list for process-isolated pi-task children.
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
import {
	agentTypeColor,
	describeActivity,
	formatGrokElapsedBracket,
	SPINNER,
	statusIcon,
	type Theme,
} from "./format.ts";
import { ConversationViewer } from "./conversation-viewer.ts";

const FLEET_KEY = "pi-task-fleet";
const VIEWER_KEY = "pi-task-viewer";
const MAX_AGENT_ROWS = 5;
const TICK_MS = 200;
const FINISHED_LINGER_MS = 4000;

export type FleetUICtx = {
	setWidget(
		key: string,
		content:
			| undefined
			| ((tui: any, theme: Theme) => {
					render(width: number): string[];
					invalidate(): void;
					dispose?(): void;
			  }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
	onTerminalInput(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void;
	getEditorText(): string;
	notify(message: string, type?: "info" | "warning" | "error"): void;
};

type MainEntry = { kind: "main" };
type TaskEntry = { kind: "task"; view: TaskView };
type FleetEntry = MainEntry | TaskEntry;

function rightAlign(left: string, right: string, width: number): string {
	const rightW = visibleWidth(right);
	const maxLeft = Math.max(0, width - rightW - 1);
	const leftClamped = truncateToWidth(left, maxLeft);
	const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW);
	return truncateToWidth(leftClamped + " ".repeat(gap) + right, width);
}

export class FleetList {
	private ui: FleetUICtx | undefined;
	private tui: any | undefined;
	private inputUnsub: (() => void) | undefined;
	private rosterUnsub: (() => void) | undefined;
	private widgetRegistered = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private enabled = true;
	private active = false;
	private selectedIndex = 0;
	private pendingKillId: string | undefined;
	private viewerClose: (() => void) | undefined;
	private viewingTaskId: string | undefined;
	private viewerInstance: ConversationViewer | undefined;
	private viewerInputUnsub: (() => void) | undefined;
	private viewerWidgetRegistered = false;
	private onStopTask: (taskId: string) => boolean;

	constructor(onStopTask: (taskId: string) => boolean) {
		this.onStopTask = onStopTask;
		this.rosterUnsub = roster.subscribe(() => this.update());
	}

	setEnabled(enabled: boolean): void {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (!enabled) this.active = false;
		this.update();
	}

	setUICtx(ui: FleetUICtx): void {
		if (ui === this.ui) return;
		this.inputUnsub?.();
		this.ui = ui;
		this.widgetRegistered = false;
		this.tui = undefined;
		this.inputUnsub = ui.onTerminalInput((data) => this.handleKey(data));
	}

	ensureTimer(): void {
		if (!this.timer) this.timer = setInterval(() => this.update(), TICK_MS);
	}

	onTaskFinished(_id: string): void {
		this.update();
	}

	dispose(): void {
		this.closeConversationViewer();
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.inputUnsub?.();
		this.inputUnsub = undefined;
		this.rosterUnsub?.();
		this.rosterUnsub = undefined;
		this.viewingTaskId = undefined;
		if (this.ui && this.widgetRegistered) this.ui.setWidget(FLEET_KEY, undefined);
		this.widgetRegistered = false;
		this.tui = undefined;
		this.active = false;
		this.ui = undefined;
	}

	update(): void {
		if (!this.ui) return;

		// Keep the fleet list hidden while its conversation viewer occupies the
		// bottom dock.
		if (this.viewingTaskId) {
			if (this.widgetRegistered) {
				this.ui.setWidget(FLEET_KEY, undefined);
				this.widgetRegistered = false;
				this.tui = undefined;
			}
			return;
		}

		const hasTasks = this.enabled && this.taskViews().length > 0;

		if (!hasTasks) {
			if (this.widgetRegistered) {
				this.ui.setWidget(FLEET_KEY, undefined);
				this.widgetRegistered = false;
				this.tui = undefined;
			}
			if (this.timer) {
				clearInterval(this.timer);
				this.timer = undefined;
			}
			this.active = false;
			this.selectedIndex = 0;
			return;
		}

		this.clampSelection();
		this.ensureTimer();

		if (!this.widgetRegistered) {
			this.ui.setWidget(
				FLEET_KEY,
				(tui, theme) => {
					this.tui = tui;
					return {
						render: (w: number) => this.renderBar(w, theme),
						invalidate: () => {
							this.widgetRegistered = false;
							this.tui = undefined;
						},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
		} else {
			this.tui?.requestRender();
		}
	}

	private taskViews(): TaskView[] {
		const now = Date.now();
		return roster
			.list()
			.filter(
				(v) =>
					v.record.sessionPath &&
					(v.record.state === "running" ||
						v.record.state === "queued" ||
						v.record.id === this.viewingTaskId ||
						(v.completedAtMs != null && now - v.completedAtMs < FINISHED_LINGER_MS)),
			)
			.sort((a, b) => a.startedAtMs - b.startedAtMs);
	}

	private fleetRoster(): FleetEntry[] {
		return [
			{ kind: "main" },
			...this.taskViews().map((view) => ({ kind: "task" as const, view })),
		];
	}

	private clampSelection(): void {
		const max = this.fleetRoster().length - 1;
		if (this.selectedIndex > max) this.selectedIndex = Math.max(0, max);
		if (this.selectedIndex < 0) this.selectedIndex = 0;
	}

	handleKey(data: string): { consume?: boolean; data?: string } | undefined {
		if (!this.enabled || !this.ui) return undefined;
		if (isKeyRelease(data)) return undefined;
		if (this.viewerClose) return undefined;
		if (!this.editorHasFocus()) {
			if (this.active) this.deactivate();
			return undefined;
		}

		if (!this.active) {
			const isActivator = matchesKey(data, "down") || matchesKey(data, "left");
			if (isActivator && this.taskViews().length > 0 && this.ui.getEditorText() === "") {
				this.active = true;
				this.selectedIndex = 0;
				this.update();
				return { consume: true };
			}
			return undefined;
		}

		if (matchesKey(data, "down")) {
			const max = this.fleetRoster().length - 1;
			this.selectedIndex = Math.min(max, this.selectedIndex + 1);
			this.pendingKillId = undefined;
			this.update();
			return { consume: true };
		}
		if (matchesKey(data, "up")) {
			if (this.selectedIndex === 0) {
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
			this.openSelected();
			return { consume: true };
		}
		if (data === "x" || data === "X") {
			const entry = this.fleetRoster()[this.selectedIndex];
			if (!entry || entry.kind === "main") {
				this.ui.notify("Select a task to stop.", "info");
				return { consume: true };
			}
			const view = entry.view;
			if (view.record.state !== "running" && view.record.state !== "queued") {
				this.ui.notify("Task is not running.", "info");
				return { consume: true };
			}
			if (this.pendingKillId !== view.record.id) {
				this.pendingKillId = view.record.id;
				this.ui.notify(`Press x again to stop "${view.record.description}".`, "warning");
				this.update();
				return { consume: true };
			}
			if (this.onStopTask(view.record.id)) {
				this.ui.notify(`Stopped "${view.record.description}".`, "info");
			}
			this.pendingKillId = undefined;
			this.update();
			return { consume: true };
		}

		this.deactivate();
		return undefined;
	}

	private editorHasFocus(): boolean {
		const focused = (this.tui as { focusedComponent?: unknown } | undefined)?.focusedComponent;
		return focused == null || focused instanceof Editor;
	}

	private deactivate(): void {
		this.active = false;
		this.selectedIndex = 0;
		this.pendingKillId = undefined;
		this.update();
	}

	private openSelected(): void {
		const entry = this.fleetRoster()[this.selectedIndex];
		if (!entry || entry.kind === "main") {
			this.deactivate();
			return;
		}
		this.openConversationViewer(entry.view);
	}

	/**
	 * Open a task conversation in the bottom editor dock, leaving the main
	 * conversation visible above it.
	 */
	openConversationViewer(view: TaskView): void {
		if (!this.ui || this.viewingTaskId) return;
		if (!view.record.sessionPath) {
			this.ui.notify(`Task is ${view.record.state} — no session available.`, "info");
			return;
		}
		this.viewingTaskId = view.record.id;
		const taskId = view.record.id;
		this.viewerClose = () => this.closeConversationViewer();

		const onStop = () => {
			if (this.onStopTask(taskId)) {
				this.ui?.notify(`Stopped "${view.record.description}".`, "info");
			}
		};

		this.ui.setWidget(
			VIEWER_KEY,
			(tui, theme) => {
				this.viewerInstance = new ConversationViewer(
					tui,
					taskId,
					theme,
					this.viewerClose!,
					onStop,
				);
				return {
					render: (width: number) => this.viewerInstance!.render(width),
					invalidate: () => this.viewerInstance?.invalidate(),
					dispose: () => this.viewerInstance?.dispose(),
				};
			},
			{ placement: "aboveEditor" },
		);
		this.viewerWidgetRegistered = true;
		this.viewerInputUnsub = this.ui.onTerminalInput((data) => {
			if (!this.viewerInstance || this.viewingTaskId !== taskId) return undefined;
			this.viewerInstance.handleInput(data);
			return { consume: true };
		});
		this.update();
	}

	private closeConversationViewer(): void {
		if (!this.ui) return;

		this.viewerInstance?.dispose();
		this.viewerInstance = undefined;
		if (this.viewerWidgetRegistered) {
			this.ui.setWidget(VIEWER_KEY, undefined);
			this.viewerWidgetRegistered = false;
		}
		this.viewerInputUnsub?.();
		this.viewerInputUnsub = undefined;

		if (this.viewingTaskId) {
			const idx = this.fleetRoster().findIndex(
				(e) => e.kind === "task" && e.view.record.id === this.viewingTaskId,
			);
			if (idx >= 0) this.selectedIndex = idx;
		}
		this.viewingTaskId = undefined;
		this.viewerClose = undefined;
		this.update();
	}

	private fleetTick = 0;

	private renderBar(width: number, theme: Theme): string[] {
		const tasks = this.fleetRoster().slice(1) as TaskEntry[];
		if (tasks.length === 0) return [];
		const sel = Math.min(this.selectedIndex, tasks.length);
		this.fleetTick++;

		const hint = this.active
			? "↑↓ · enter · x stop · esc"
			: "↓ manage · Ctrl+T";
		const lines: string[] = [];
		lines.push(truncateToWidth(theme.fg("dim", hint), width));
		lines.push(
			rightAlign(
				this.selectionPrefix(0, sel, theme) + theme.fg(sel === 0 ? "accent" : "dim", "main"),
				"",
				width,
			),
		);

		const visible = Math.min(MAX_AGENT_ROWS, tasks.length);
		const selTask = Math.max(0, sel - 1);
		const start = selTask < visible ? 0 : selTask - visible + 1;
		const hiddenBelow = tasks.length - (start + visible);
		const frame = SPINNER[this.fleetTick % SPINNER.length];

		if (start > 0) lines.push(rightAlign("", theme.fg("dim", `↑ ${start} more`), width));
		for (let a = start; a < start + visible; a++) {
			lines.push(this.renderTaskRow(a + 1, sel, tasks[a].view, width, theme, frame));
		}
		if (hiddenBelow > 0) {
			lines.push(rightAlign("", theme.fg("dim", `↓ ${hiddenBelow} more`), width));
		}

		return lines;
	}

	/** Grok-like selection: accent ▌ on selected row, space otherwise. */
	private selectionPrefix(rosterIndex: number, sel: number, theme: Theme): string {
		return rosterIndex === sel ? theme.fg("accent", "▌") : " ";
	}

	private renderTaskRow(
		rosterIndex: number,
		sel: number,
		view: TaskView,
		width: number,
		theme: Theme,
		frame: string,
	): string {
		const { record, activity, startedAtMs, completedAtMs } = view;
		const running = record.state === "running";
		const done = record.state === "completed";
		const elapsedMs = (completedAtMs ?? Date.now()) - startedAtMs;
		const icon = statusIcon(record.state, theme, running ? frame : undefined);
		const typeLabel = theme.fg(agentTypeColor(record.state), record.agent);
		const desc = running ? theme.fg("muted", record.description) : theme.fg("dim", record.description);
		const activityText = running ? describeActivity(activity) : "";
		const left =
			this.selectionPrefix(rosterIndex, sel, theme) +
			`${icon} ${typeLabel}  ${desc}` +
			(activityText ? theme.fg("dim", ` — ${activityText}`) : "");
		const right = theme.fg("dim", formatGrokElapsedBracket(elapsedMs, done));
		return rightAlign(left, right, width);
	}
}

