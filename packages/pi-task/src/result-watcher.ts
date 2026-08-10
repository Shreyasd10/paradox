/**
 * Background result watcher — watches the task-state directory for result files
 * written by background child processes, and delivers exactly one terminal
 * completion notification into the parent session via pi.sendUserMessage.
 *
 * Uses fs.watch with polling fallback. Survives extension reload via
 * primeExistingResults (reconciler).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCompletionKey, readResult, deleteResult, readRecord, getTaskStateRoot } from "./task-state.ts";
import type { TaskResult } from "./types.ts";
import { emptyUsage, isTerminalState } from "./types.ts";

const POLL_INTERVAL_MS = 3000;
const RESTART_DELAY_MS = 3000;

interface WatcherState {
	watcher: fs.FSWatcher | null;
	restartTimer: NodeJS.Timeout | null;
	pollInterval: NodeJS.Timeout | null;
	deliveredKeys: Set<string>;
}

export interface ResultWatcher {
	start: () => void;
	prime: () => void;
	stop: () => void;
}

export function createResultWatcher(
	pi: ExtensionAPI,
	getSessionId: () => string | null,
): ResultWatcher {
	const state: WatcherState = {
		watcher: null,
		restartTimer: null,
		pollInterval: null,
		deliveredKeys: new Set(),
	};

	const resultsDir = getTaskStateRoot();

	const deliverResult = (taskId: string, result: TaskResult) => {
		const record = readRecord(taskId);
		const sessionId = getSessionId();
		// A result belongs only to the session that created the task. Retain
		// unmatched files for the originating session's watcher to reconcile.
		if (!record || !sessionId || record.parentId !== sessionId) return;

		// Dedupe by task ID + state + result identity (R15)
		const resultIdentity = `${result.exitCode}:${result.output.length}:${result.truncated}`;
		const key = buildCompletionKey(taskId, result.state, resultIdentity);
		if (state.deliveredKeys.has(key)) {
			deleteResult(taskId);
			return;
		}
		state.deliveredKeys.add(key);

		const agentName = record?.agent ?? "unknown";
		const description = record?.description ?? agentName;
		const status =
			result.state === "timed_out"
				? "timed out"
				: result.state === "interrupted"
					? "stopped"
					: result.state;
		const textBody = result.error
			? `Task ${agentName} ${status}:\nError: ${result.error}`
			: `Task ${agentName} ${status}:\n${result.output}`;

		const startedMs = record?.startedAt ? Date.parse(record.startedAt) : Date.now();
		const completedMs = record?.completedAt ? Date.parse(record.completedAt) : Date.now();
		const details = {
			taskId,
			agent: agentName,
			description,
			state: result.state,
			outputPreview: result.error || result.output || "",
			usage: record?.usage ?? emptyUsage(),
			durationMs: Math.max(0, completedMs - startedMs),
			error: result.error,
		};

		// Prefer styled custom message; fall back to plain user message (R12)
		try {
			pi.sendMessage(
				{
					customType: "pi-task-notification",
					content: textBody,
					display: true,
					details,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} catch {
			try {
				pi.sendUserMessage(textBody, { deliverAs: "followUp" });
			} catch {
				try {
					pi.sendUserMessage(textBody);
				} catch {
					state.deliveredKeys.delete(key);
					return;
				}
			}
		}

		deleteResult(taskId);
	};

	const handleFile = (file: string) => {
		if (!file.endsWith(".json")) return;
		const taskId = file.replace(/\.json$/, "");
		// Result files are at <task-state-root>/<task-id>/result.json
		// But fs.watch gives us the filename in the watched dir
		// We need to check if this is a directory change or a result.json
		const resultPath = path.join(resultsDir, taskId);
		if (!fs.existsSync(resultPath) || !fs.statSync(resultPath).isDirectory()) return;

		const result = readResult(taskId);
		if (!result) return;

		// Only deliver terminal results
		if (!isTerminalState(result.state)) return;

		deliverResult(taskId, result);
	};

	const handleResultFile = (taskId: string) => {
		const result = readResult(taskId);
		if (!result) return;
		if (!isTerminalState(result.state)) return;
		deliverResult(taskId, result);
	};

	const prime = () => {
		// Reconcile undelivered results on startup/reload (R12)
		if (!fs.existsSync(resultsDir)) return;
		try {
			const dirs = fs.readdirSync(resultsDir, { withFileTypes: true });
			for (const entry of dirs) {
				if (!entry.isDirectory()) continue;
				const resultPath = path.join(resultsDir, entry.name, "result.json");
				if (fs.existsSync(resultPath)) {
					handleResultFile(entry.name);
				}
			}
		} catch {
			// best effort
		}
	};

	const startPolling = () => {
		if (state.pollInterval) return;
		prime();
		state.pollInterval = setInterval(prime, POLL_INTERVAL_MS);
		state.pollInterval.unref?.();
	};

	const scheduleRestart = () => {
		if (state.restartTimer) return;
		state.restartTimer = setTimeout(() => {
			state.restartTimer = null;
			try {
				fs.mkdirSync(resultsDir, { recursive: true });
				start();
			} catch {
				scheduleRestart();
			}
		}, RESTART_DELAY_MS);
		state.restartTimer.unref?.();
	};

	const start = () => {
		if (state.watcher) return;
		if (state.restartTimer) {
			clearTimeout(state.restartTimer);
			state.restartTimer = null;
		}
		if (state.pollInterval) {
			clearInterval(state.pollInterval);
			state.pollInterval = null;
		}

		try {
			fs.mkdirSync(resultsDir, { recursive: true });
			const watchDir = fs.realpathSync(resultsDir);
			state.watcher = fs.watch(watchDir, { recursive: true }, (_ev, file) => {
				if (!file) return;
				// file is relative to watched dir: <task-id>/result.json
				if (!file.endsWith("result.json")) return;
				const parts = file.split(path.sep);
				if (parts.length < 2) return;
				const taskId = parts[0];
				handleResultFile(taskId);
			});
			state.watcher.on("error", () => {
				state.watcher?.close();
				state.watcher = null;
				startPolling();
			});
			state.watcher.unref?.();
			// Prime on start to catch results written before watcher was ready
			prime();
		} catch {
			startPolling();
		}
	};

	const stop = () => {
		state.watcher?.close();
		state.watcher = null;
		if (state.restartTimer) {
			clearTimeout(state.restartTimer);
			state.restartTimer = null;
		}
		if (state.pollInterval) {
			clearInterval(state.pollInterval);
			state.pollInterval = null;
		}
	};

	return { start, prime, stop };
}
