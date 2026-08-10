/**
 * Task state persistence — one directory per task under a private task-state root.
 * Atomic status/result writes via temp-file + rename.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TaskRecord, TaskResult, TaskState } from "./types.ts";

const TASK_STATE_DIR_NAME = "task-state";

export function getTaskStateRoot(): string {
	return path.join(os.homedir(), ".pi", "agent", TASK_STATE_DIR_NAME);
}

export function getTaskDir(taskId: string): string {
	return path.join(getTaskStateRoot(), taskId);
}

export function getRecordPath(taskId: string): string {
	return path.join(getTaskDir(taskId), "record.json");
}

export function getResultPath(taskId: string): string {
	return path.join(getTaskDir(taskId), "result.json");
}

export function ensureTaskDir(taskId: string): string {
	const dir = getTaskDir(taskId);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function atomicWrite(filePath: string, data: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.tmp-${randomUUID().slice(0, 8)}`;
	fs.writeFileSync(tmp, data, { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(tmp, filePath);
}

export function writeRecord(record: TaskRecord): void {
	atomicWrite(getRecordPath(record.id), JSON.stringify(record, null, 2));
}

export function readRecord(taskId: string): TaskRecord | null {
	try {
		const data = fs.readFileSync(getRecordPath(taskId), "utf-8");
		return JSON.parse(data) as TaskRecord;
	} catch {
		return null;
	}
}

export function writeResult(taskId: string, result: TaskResult): void {
	atomicWrite(getResultPath(taskId), JSON.stringify(result, null, 2));
}

export function readResult(taskId: string): TaskResult | null {
	try {
		const data = fs.readFileSync(getResultPath(taskId), "utf-8");
		return JSON.parse(data) as TaskResult;
	} catch {
		return null;
	}
}

export function deleteResult(taskId: string): void {
	try {
		fs.unlinkSync(getResultPath(taskId));
	} catch {
		// best effort
	}
}

export function updateRecordState(
	taskId: string,
	state: TaskState,
	partial: Partial<TaskRecord> = {},
): TaskRecord | null {
	const record = readRecord(taskId);
	if (!record) return null;
	const updated: TaskRecord = {
		...record,
		state,
		...partial,
		...(isTerminalOrRunning(state) ? {} : {}),
	};
	if (state === "running" && !updated.startedAt) {
		updated.startedAt = new Date().toISOString();
	}
	if (isTerminalStateValue(state)) {
		updated.completedAt = new Date().toISOString();
	}
	writeRecord(updated);
	return updated;
}

function isTerminalStateValue(state: TaskState): boolean {
	return state === "completed" || state === "failed" || state === "interrupted" || state === "timed_out";
}

function isTerminalOrRunning(_state: TaskState): boolean {
	return false; // placeholder for future logic
}

/**
 * Scan the task-state root for undelivered result files.
 * Used by the reconciler on extension reload.
 */
export function scanUndeliveredResults(): string[] {
	const root = getTaskStateRoot();
	if (!fs.existsSync(root)) return [];
	try {
		return fs
			.readdirSync(root, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.filter((id) => fs.existsSync(getResultPath(id)));
	} catch {
		return [];
	}
}

/**
 * Build a dedupe key for completion delivery.
 */
export function buildCompletionKey(taskId: string, state: TaskState, resultIdentity: string): string {
	return `${taskId}:${state}:${resultIdentity}`;
}

/**
 * Generate a stable task ID.
 */
export function generateTaskId(): string {
	return `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Derive a child session path from the parent session file.
 * Pattern: ~/.pi/agent/sessions/<parent-base>/<task-id>/session.jsonl
 */
export function deriveChildSessionPath(parentSessionFile: string | null, taskId: string): string {
	const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
	if (parentSessionFile) {
		const baseName = path.basename(parentSessionFile, ".jsonl");
		return path.join(sessionsDir, baseName, taskId, "session.jsonl");
	}
	return path.join(sessionsDir, "_orphan", taskId, "session.jsonl");
}
