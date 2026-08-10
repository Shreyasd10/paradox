import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildCompletionKey,
	deriveChildSessionPath,
	deleteResult,
	ensureTaskDir,
	generateTaskId,
	getRecordPath,
	getResultPath,
	readRecord,
	readResult,
	scanUndeliveredResults,
	writeRecord,
	writeResult,
} from "../src/task-state.ts";
import type { TaskRecord, TaskResult } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

// Override HOME for test isolation — fresh temp dir per test
let tmpHome = "";
const originalHome = process.env.HOME;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-test-"));
	process.env.HOME = tmpHome;
});

afterEach(() => {
	process.env.HOME = originalHome;
	try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeRecord(id: string, state: TaskRecord["state"] = "queued"): TaskRecord {
	return {
		id,
		parentId: null,
		agent: "test-agent",
		agentSource: "user",
		description: "test task",
		contextMode: "fresh",
		cwd: "/tmp",
		state,
		background: false,
		createdAt: new Date().toISOString(),
		startedAt: null,
		completedAt: null,
		sessionPath: null,
		resultPath: null,
		exitCode: null,
		output: null,
		error: null,
		truncated: false,
		usage: emptyUsage(),
		model: null,
	};
}

function makeResult(taskId: string, state: TaskResult["state"] = "completed"): TaskResult {
	return {
		taskId,
		state,
		output: "test output",
		error: null,
		sessionPath: null,
		exitCode: 0,
		truncated: false,
	};
}

describe("task-state", () => {
	describe("generateTaskId", () => {
		it("generates unique IDs with task- prefix", () => {
			const id1 = generateTaskId();
			const id2 = generateTaskId();
			assert.ok(id1.startsWith("task-"));
			assert.ok(id2.startsWith("task-"));
			assert.notEqual(id1, id2);
		});
	});

	describe("ensureTaskDir + writeRecord + readRecord", () => {
		it("creates task directory and persists record", () => {
			const id = generateTaskId();
			const dir = ensureTaskDir(id);
			assert.ok(fs.existsSync(dir));

			const record = makeRecord(id);
			writeRecord(record);

			const read = readRecord(id);
			assert.ok(read);
			assert.equal(read?.id, id);
			assert.equal(read?.agent, "test-agent");
		});

		it("round-trips the optional child extension capability verbatim", () => {
			const record = makeRecord(generateTaskId());
			record.childExtensions = ["advisor", "advisor"];
			writeRecord(record);
			assert.deepEqual(readRecord(record.id)?.childExtensions, ["advisor", "advisor"]);

			const emptyRecord = makeRecord(generateTaskId());
			emptyRecord.childExtensions = [];
			writeRecord(emptyRecord);
			assert.deepEqual(readRecord(emptyRecord.id)?.childExtensions, []);
		});

		it("returns null for missing record", () => {
			assert.equal(readRecord("nonexistent-task-id"), null);
		});
	});

	describe("writeResult + readResult + deleteResult", () => {
		it("writes, reads, and deletes result files atomically", () => {
			const id = generateTaskId();
			ensureTaskDir(id);

			const result = makeResult(id);
			writeResult(id, result);

			const read = readResult(id);
			assert.ok(read);
			assert.equal(read?.taskId, id);
			assert.equal(read?.output, "test output");

			deleteResult(id);
			assert.equal(readResult(id), null);
		});
	});

	describe("buildCompletionKey", () => {
		it("produces dedupe key from taskId + state + identity", () => {
			const key = buildCompletionKey("task-1", "completed", "0:100:false");
			assert.equal(key, "task-1:completed:0:100:false");
		});

		it("produces different keys for different states", () => {
			const k1 = buildCompletionKey("task-1", "completed", "0:100:false");
			const k2 = buildCompletionKey("task-1", "failed", "0:100:false");
			assert.notEqual(k1, k2);
		});
	});

	describe("scanUndeliveredResults", () => {
		it("finds task dirs with result.json files", () => {
			const id1 = generateTaskId();
			const id2 = generateTaskId();
			ensureTaskDir(id1);
			ensureTaskDir(id2);
			writeResult(id1, makeResult(id1));
			// id2 has no result file

			const found = scanUndeliveredResults();
			assert.ok(found.includes(id1));
			assert.ok(!found.includes(id2));
		});

		it("returns empty when no results exist", () => {
			assert.deepEqual(scanUndeliveredResults(), []);
		});
	});

	describe("deriveChildSessionPath", () => {
		it("derives path from parent session file", () => {
			const parentPath = path.join(os.homedir(), ".pi", "agent", "sessions", "abc123.jsonl");
			const childPath = deriveChildSessionPath(parentPath, "task-xyz");
			assert.ok(childPath.includes("abc123"));
			assert.ok(childPath.includes("task-xyz"));
			assert.ok(childPath.endsWith("session.jsonl"));
		});

		it("falls back to _orphan for null parent", () => {
			const childPath = deriveChildSessionPath(null, "task-xyz");
			assert.ok(childPath.includes("_orphan"));
			assert.ok(childPath.includes("task-xyz"));
		});
	});

	describe("getRecordPath + getResultPath", () => {
		it("returns paths under task-state root", () => {
			const rp = getRecordPath("task-1");
			const fp = getResultPath("task-1");
			assert.ok(rp.includes("task-state"));
			assert.ok(rp.endsWith("record.json"));
			assert.ok(fp.includes("task-state"));
			assert.ok(fp.endsWith("result.json"));
		});
	});
});
