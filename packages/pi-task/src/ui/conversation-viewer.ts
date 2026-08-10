/**
 * Live bottom-dock conversation viewer for a native Pi task session.
 * Reads the persisted session.jsonl. Steer is deferred.
 */

import {
	type Component,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { TaskView } from "../activity.ts";
import { roster } from "../activity.ts";
import { readSessionMessages, sessionMtime } from "../session-reader.ts";
import {
	describeActivity,
	fgPreservingNestedStyles,
	formatDuration,
	formatTokens,
	statusIcon,
	type Theme,
	totalTokens,
} from "./format.ts";
import { createViewerKeys, type ViewerKeybindings, type ViewerKeys } from "./viewer-keys.ts";

const CHROME_LINES_BASE = 6;
const MIN_VIEWPORT = 3;
// Keep the bottom dock compact enough that the parent conversation remains visible.
export const VIEWPORT_HEIGHT_PCT = 30;

export class ConversationViewer implements Component {
	private scrollOffset = 0;
	private autoScroll = true;
	private lastInnerW = 0;
	private closed = false;
	private stopArmed = false;
	private keys: ViewerKeys;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private lastMtime = 0;
	private unsub: (() => void) | undefined;
	private tui: TUI;
	private taskId: string;
	private theme: Theme;
	private done: (result: undefined) => void;
	private onStop?: () => void;

	constructor(
		tui: TUI,
		taskId: string,
		theme: Theme,
		done: (result: undefined) => void,
		onStop?: () => void,
		keybindings?: ViewerKeybindings,
	) {
		this.tui = tui;
		this.taskId = taskId;
		this.theme = theme;
		this.done = done;
		this.onStop = onStop;
		this.keys = createViewerKeys(keybindings);
		this.lastMtime = sessionMtime(this.view()?.record.sessionPath);
		this.pollTimer = setInterval(() => {
			if (this.closed) return;
			const path = this.view()?.record.sessionPath;
			const mt = sessionMtime(path);
			if (mt !== this.lastMtime) {
				this.lastMtime = mt;
				this.tui.requestRender();
			}
		}, 250);
		this.unsub = roster.subscribe(() => {
			if (!this.closed) this.tui.requestRender();
		});
	}

	private view(): TaskView | undefined {
		return roster.get(this.taskId);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.closed = true;
			this.done(undefined);
			return;
		}

		// Enter reserved for future steer composer
		if (matchesKey(data, "enter")) {
			this.stopArmed = false;
			return;
		}

		if (matchesKey(data, "x")) {
			if (this.isStoppable()) {
				if (this.stopArmed) {
					this.stopArmed = false;
					this.onStop?.();
				} else {
					this.stopArmed = true;
				}
				this.tui.requestRender();
			}
			return;
		}
		if (this.stopArmed) this.stopArmed = false;

		const totalLines = this.buildContentLines(this.lastInnerW).length;
		const viewportHeight = this.viewportHeight();
		const maxScroll = Math.max(0, totalLines - viewportHeight);

		if (this.keys.scrollUp(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.keys.scrollDown(data)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.keys.pageUp(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - viewportHeight);
			this.autoScroll = false;
		} else if (this.keys.pageDown(data)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportHeight);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.autoScroll = false;
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = maxScroll;
			this.autoScroll = true;
		}
	}

	render(width: number): string[] {
		if (width < 6) return [];
		const th = this.theme;
		const view = this.view();
		const innerW = width - 4;
		this.lastInnerW = innerW;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};
		const row = (content: string) =>
			th.fg("border", "│") +
			" " +
			truncateToWidth(pad(content, innerW), innerW) +
			" " +
			th.fg("border", "│");
		const hrTop = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const hrMid = row(th.fg("dim", "─".repeat(innerW)));

		lines.push(hrTop);
		if (!view) {
			lines.push(row(th.fg("dim", "Task not found")));
			lines.push(hrMid);
			lines.push(row(th.fg("dim", "Esc close")));
			lines.push(hrBot);
			return lines;
		}

		const { record, activity, startedAtMs, completedAtMs } = view;
		const icon = statusIcon(record.state, th);
		const duration = formatDuration(startedAtMs, completedAtMs);
		const headerParts: string[] = [duration];
		if (activity.toolUses > 0) {
			headerParts.unshift(`${activity.toolUses} tool${activity.toolUses === 1 ? "" : "s"}`);
		}
		const tokens = totalTokens(record.usage);
		if (tokens > 0) headerParts.push(formatTokens(tokens));

		lines.push(
			row(
				`${icon} ${th.bold(record.agent)}  ${th.fg("muted", record.description)} ${th.fg("dim", "·")} ` +
					fgPreservingNestedStyles(th, "dim", headerParts.join(" · ")),
			),
		);
		lines.push(row(th.fg("dim", `  id ${record.id}`)));
		lines.push(hrMid);

		const contentLines = this.buildContentLines(innerW);
		const viewportHeight = this.viewportHeight();
		const maxScroll = Math.max(0, contentLines.length - viewportHeight);
		if (this.autoScroll) this.scrollOffset = maxScroll;
		const visibleStart = Math.min(this.scrollOffset, maxScroll);
		const visible = contentLines.slice(visibleStart, visibleStart + viewportHeight);
		for (let i = 0; i < viewportHeight; i++) {
			lines.push(row(visible[i] ?? ""));
		}

		lines.push(hrMid);
		const sep = th.fg("dim", " · ");
		const actions: string[] = [];
		if (this.isStoppable()) {
			actions.push(this.stopArmed ? th.fg("error", "x again to STOP") : th.fg("dim", "x stop"));
		}
		actions.push(th.fg("dim", "steer: deferred"));
		const footerRight = th.fg("dim", "↑↓ scroll · Esc close");
		const scrollPct =
			contentLines.length <= viewportHeight
				? "100%"
				: `${Math.round(((visibleStart + viewportHeight) / contentLines.length) * 100)}%`;
		const count = th.fg("dim", `${contentLines.length} lines · ${scrollPct}`);
		const withCount = [count, ...actions].join(sep);
		const footerLeft =
			visibleWidth(withCount) + visibleWidth(footerRight) + 1 <= innerW
				? withCount
				: actions.join(sep);
		const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
		lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
		lines.push(hrBot);
		return lines;
	}

	private isStoppable(): boolean {
		const state = this.view()?.record.state;
		return !!this.onStop && (state === "running" || state === "queued");
	}

	invalidate(): void {
		/* no cached render state */
	}

	dispose(): void {
		this.closed = true;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.unsub?.();
		this.unsub = undefined;
	}

	private viewportHeight(): number {
		const maxRows = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
		return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES_BASE - 1);
	}

	private buildContentLines(width: number): string[] {
		if (width <= 0) return [];
		const th = this.theme;
		const view = this.view();
		const messages = readSessionMessages(view?.record.sessionPath);
		const lines: string[] = [];

		if (messages.length === 0) {
			lines.push(th.fg("dim", "(waiting for first message...)"));
			if (view?.record.state === "running") {
				lines.push("");
				lines.push(
					truncateToWidth(
						th.fg("accent", "▍ ") + th.fg("dim", describeActivity(view.activity)),
						width,
					),
				);
			}
			return lines.map((l) => truncateToWidth(l, width));
		}

		let needsSeparator = false;
		for (const msg of messages) {
			if (msg.role === "user") {
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.fg("accent", "[User]"));
				for (const line of wrapTextWithAnsi(msg.text.trim(), width)) lines.push(line);
			} else if (msg.role === "assistant") {
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.bold("[Assistant]"));
				if (msg.text.trim()) {
					for (const line of wrapTextWithAnsi(msg.text.trim(), width)) lines.push(line);
				}
				for (const name of msg.tools) {
					lines.push(truncateToWidth(th.fg("muted", `  [Tool: ${name}]`), width));
				}
			} else if (msg.role === "toolResult") {
				const truncated =
					msg.text.length > 500 ? `${msg.text.slice(0, 500)}... (truncated)` : msg.text;
				if (!truncated.trim()) continue;
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.fg("dim", "[Result]"));
				for (const line of wrapTextWithAnsi(truncated.trim(), width)) {
					lines.push(th.fg("dim", line));
				}
			} else if (msg.role === "bash") {
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(truncateToWidth(th.fg("muted", `  $ ${msg.command}`), width));
				if (msg.output?.trim()) {
					const out =
						msg.output.length > 500 ? `${msg.output.slice(0, 500)}... (truncated)` : msg.output;
					for (const line of wrapTextWithAnsi(out.trim(), width)) {
						lines.push(th.fg("dim", line));
					}
				}
			}
			needsSeparator = true;
		}

		if (view?.record.state === "running") {
			const act = describeActivity(view.activity);
			lines.push("");
			lines.push(truncateToWidth(th.fg("accent", "⟳ ") + th.fg("dim", act), width));
		}

		return lines.map((l) => truncateToWidth(l, width));
	}
}
