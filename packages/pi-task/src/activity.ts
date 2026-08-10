/**
 * In-memory live activity + task roster for the TUI.
 * Updated from child JSON stream events; not persisted.
 */

import type { TaskActivity, TaskRecord, TaskState, UsageStats } from "./types.ts";
import { emptyActivity, isTerminalState } from "./types.ts";

export type TaskEvent =
	| { type: "tool_start"; toolCallId: string; toolName: string }
	| { type: "tool_end"; toolCallId: string; toolName: string }
	| { type: "text_delta"; delta: string }
	| { type: "message_end"; role?: string; usage?: Partial<UsageStats> }
	| { type: "turn_start" };

export interface TaskView {
	record: TaskRecord;
	activity: TaskActivity;
	/** Epoch ms for linger math (from ISO timestamps). */
	startedAtMs: number;
	completedAtMs?: number;
}

type Listener = () => void;

class TaskRoster {
	private views = new Map<string, TaskView>();
	private listeners = new Set<Listener>();

	subscribe(fn: Listener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(): void {
		for (const fn of this.listeners) {
			try {
				fn();
			} catch {
				/* UI listeners must not throw into runtime */
			}
		}
	}

	upsert(record: TaskRecord, activity?: TaskActivity): void {
		const existing = this.views.get(record.id);
		const startedAtMs = record.startedAt
			? Date.parse(record.startedAt)
			: existing?.startedAtMs ?? Date.now();
		const completedAtMs = record.completedAt
			? Date.parse(record.completedAt)
			: isTerminalState(record.state)
				? Date.now()
				: existing?.completedAtMs;
		this.views.set(record.id, {
			record: { ...record },
			activity: activity ?? existing?.activity ?? emptyActivity(),
			startedAtMs,
			completedAtMs,
		});
		this.emit();
	}

	applyEvent(taskId: string, event: TaskEvent): void {
		const view = this.views.get(taskId);
		if (!view) return;
		const a = view.activity;
		switch (event.type) {
			case "tool_start":
				a.activeTools.set(event.toolCallId, event.toolName);
				a.toolUses += 1;
				break;
			case "tool_end":
				a.activeTools.delete(event.toolCallId);
				break;
			case "text_delta":
				a.responseText = (a.responseText + event.delta).slice(-400);
				break;
			case "message_end":
				if (event.role === "assistant") {
					a.turnCount += 1;
					a.responseText = "";
				}
				a.activeTools.clear();
				if (event.usage) {
					const u = view.record.usage;
					// Events must carry per-message deltas; roster adds each exactly once.
					u.input += event.usage.input ?? 0;
					u.output += event.usage.output ?? 0;
					u.cacheRead += event.usage.cacheRead ?? 0;
					u.cacheWrite += event.usage.cacheWrite ?? 0;
					u.cost += event.usage.cost ?? 0;
					if (event.usage.turns !== undefined) u.turns = event.usage.turns;
				}
				break;
			case "turn_start":
				a.responseText = "";
				break;
		}
		this.emit();
	}

	markFinished(taskId: string, record: TaskRecord): void {
		this.upsert(record);
	}

	get(taskId: string): TaskView | undefined {
		return this.views.get(taskId);
	}

	list(): TaskView[] {
		return [...this.views.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
	}

	listByState(state: TaskState): TaskView[] {
		return this.list().filter((v) => v.record.state === state);
	}

	remove(taskId: string): void {
		this.views.delete(taskId);
		this.emit();
	}

	clear(): void {
		this.views.clear();
		this.emit();
	}
}

export const roster = new TaskRoster();
