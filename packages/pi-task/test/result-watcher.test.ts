import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	writeRecord,
	writeResult,
	ensureTaskDir,
	generateTaskId,
	getTaskStateRoot,
} from "../src/task-state.ts";
import { createResultWatcher } from "../src/result-watcher.ts";
import type { TaskResult } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

let tmpHome = "";
const originalHome = process.env.HOME;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-watcher-"));
	process.env.HOME = tmpHome;
});

afterEach(() => {
	process.env.HOME = originalHome;
	try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeResult(taskId: string, state: TaskResult["state"] = "completed", output = "done"): TaskResult {
	return {
		taskId,
		state,
		output,
		error: null,
		sessionPath: null,
		exitCode: state === "completed" ? 0 : 1,
		truncated: false,
	};
}

function writeBackgroundRecord(id: string, parentId = "test-session"): void {
	writeRecord({
		id,
		parentId,
		agent: "test-agent",
		agentSource: "user",
		description: "test task",
		contextMode: "fresh",
		cwd: "/tmp",
		state: "running",
		background: true,
		createdAt: new Date().toISOString(),
		startedAt: new Date().toISOString(),
		completedAt: null,
		sessionPath: null,
		resultPath: null,
		exitCode: null,
		output: null,
		error: null,
		truncated: false,
		usage: emptyUsage(),
		model: null,
	});
}

// Minimal mock ExtensionAPI for the watcher
function mockPi(delivered: string[]): any {
	return {
		sendMessage: (msg: { content?: string }, _opts?: any) => {
			delivered.push(String(msg?.content ?? ""));
		},
		sendUserMessage: (content: string, _opts?: any) => {
			delivered.push(content);
		},
	};
}

describe("result-watcher", () => {
	describe("prime (reconciler)", () => {
		it("delivers undelivered results on prime", async () => {
			const delivered: string[] = [];
			const pi = mockPi(delivered);
			const watcher = createResultWatcher(pi, () => "test-session");

			// Write a result file before starting the watcher
			const id = generateTaskId();
			ensureTaskDir(id);
			writeBackgroundRecord(id);
			writeResult(id, makeResult(id));

			watcher.prime();

			// Give async delivery a tick
			await new Promise((r) => setTimeout(r, 50));

			assert.equal(delivered.length, 1);
			assert.ok(delivered[0].includes("test-agent"));
			assert.ok(delivered[0].includes("completed"));

			watcher.stop();
		});

		it("ignores results that belong to another parent session", async () => {
			const delivered: string[] = [];
			const pi = mockPi(delivered);
			const watcher = createResultWatcher(pi, () => "current-session");

			const id = generateTaskId();
			ensureTaskDir(id);
			writeBackgroundRecord(id, "other-session");
			writeResult(id, makeResult(id, "completed", "must stay isolated"));

			watcher.prime();
			await new Promise((r) => setTimeout(r, 50));

			assert.equal(delivered.length, 0);
			assert.ok(fs.existsSync(path.join(getTaskStateRoot(), id, "result.json")));

			watcher.stop();
		});

		it("deduplicates delivery on repeated prime", async () => {
			const delivered: string[] = [];
			const pi = mockPi(delivered);
			const watcher = createResultWatcher(pi, () => "test-session");

			const id = generateTaskId();
			ensureTaskDir(id);
			writeBackgroundRecord(id);
			writeResult(id, makeResult(id));

			watcher.prime();
			await new Promise((r) => setTimeout(r, 50));
			watcher.prime(); // should not re-deliver
			await new Promise((r) => setTimeout(r, 50));

			assert.equal(delivered.length, 1);

			watcher.stop();
		});

		it("does not deliver non-terminal results", async () => {
			const delivered: string[] = [];
			const pi = mockPi(delivered);
			const watcher = createResultWatcher(pi, () => "test-session");

			const id = generateTaskId();
			ensureTaskDir(id);
			writeResult(id, makeResult(id, "running"));

			watcher.prime();
			await new Promise((r) => setTimeout(r, 50));

			assert.equal(delivered.length, 0);

			watcher.stop();
		});

		it("renders timeout status in human-readable form", async () => {
			const delivered: string[] = [];
			const pi = mockPi(delivered);
			const watcher = createResultWatcher(pi, () => "test-session");

			const id = generateTaskId();
			ensureTaskDir(id);
			writeBackgroundRecord(id);
			writeResult(id, makeResult(id, "timed_out", "Timed out before producing assistant output."));

			watcher.prime();
			await new Promise((r) => setTimeout(r, 50));

			assert.equal(delivered.length, 1);
			assert.ok(delivered[0].includes("timed out"));
			assert.ok(!delivered[0].includes("timed_out"));

			watcher.stop();
		});
	});

	describe("start + fs.watch", () => {
		it("detects new result files written after start", async () => {
			const delivered: string[] = [];
			const pi = mockPi(delivered);
			const watcher = createResultWatcher(pi, () => "test-session");

			watcher.start();
			await new Promise((r) => setTimeout(r, 100));

			// Write a new result file
			const id = generateTaskId();
			ensureTaskDir(id);
			writeBackgroundRecord(id);
			writeResult(id, makeResult(id, "completed", "background output"));

			// Wait for fs.watch to pick it up
			await new Promise((r) => setTimeout(r, 500));

			assert.ok(delivered.length >= 1, `expected delivery, got ${delivered.length}`);
			assert.ok(delivered[0].includes("background output"));

			watcher.stop();
		});
	});

	describe("stop", () => {
		it("stops cleanly without errors", () => {
			const pi = mockPi([]);
			const watcher = createResultWatcher(pi, () => "test-session");
			watcher.start();
			watcher.stop();
			// no throw = pass
			assert.ok(true);
		});
	});
});
