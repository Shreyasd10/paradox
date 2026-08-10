import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	CHILD_EXTENSION_CAPABILITIES,
	emptyUsage,
	isTerminalState,
	isFailedState,
	type TaskRecord,
	type TaskResult,
} from "../src/types.ts";

describe("types", () => {
	describe("emptyUsage", () => {
		it("returns zeroed usage stats", () => {
			const u = emptyUsage();
			assert.equal(u.input, 0);
			assert.equal(u.output, 0);
			assert.equal(u.cacheRead, 0);
			assert.equal(u.cacheWrite, 0);
			assert.equal(u.cost, 0);
			assert.equal(u.turns, 0);
		});
	});

	it("exposes only the exact Advisor child extension capability", () => {
		assert.deepEqual(CHILD_EXTENSION_CAPABILITIES, ["advisor"]);
	});

	describe("persisted shape compatibility", () => {
		it("accepts historical TaskRecord shapes without policy fields", () => {
			const legacy: TaskRecord = {
				id: "t1",
				parentId: null,
				agent: "locator",
				agentSource: "user",
				description: "find files",
				contextMode: "fresh",
				cwd: "/tmp",
				state: "completed",
				background: false,
				createdAt: "2026-01-01T00:00:00.000Z",
				startedAt: "2026-01-01T00:00:01.000Z",
				completedAt: "2026-01-01T00:00:02.000Z",
				sessionPath: null,
				resultPath: null,
				exitCode: 0,
				output: "done",
				error: null,
				truncated: false,
				usage: emptyUsage(),
				model: null,
			};
			assert.equal(legacy.policy, undefined);
			assert.equal(legacy.limitReason, undefined);
			assert.equal(legacy.childExtensions, undefined);
		});

		it("accepts historical TaskResult shapes without policy fields", () => {
			const legacy: TaskResult = {
				taskId: "t1",
				state: "completed",
				output: "done",
				error: null,
				sessionPath: null,
				exitCode: 0,
				truncated: false,
			};
			assert.equal(legacy.policy, undefined);
			assert.equal(legacy.limitReason, undefined);
		});
	});

	describe("isTerminalState", () => {
		it("returns true for completed, failed, interrupted, timed_out", () => {
			assert.ok(isTerminalState("completed"));
			assert.ok(isTerminalState("failed"));
			assert.ok(isTerminalState("interrupted"));
			assert.ok(isTerminalState("timed_out"));
		});

		it("returns false for queued and running", () => {
			assert.equal(isTerminalState("queued"), false);
			assert.equal(isTerminalState("running"), false);
		});
	});

	describe("isFailedState", () => {
		it("returns true for failed, interrupted, timed_out", () => {
			assert.ok(isFailedState("failed"));
			assert.ok(isFailedState("interrupted"));
			assert.ok(isFailedState("timed_out"));
		});

		it("returns false for completed, queued, running", () => {
			assert.equal(isFailedState("completed"), false);
			assert.equal(isFailedState("queued"), false);
			assert.equal(isFailedState("running"), false);
		});
	});
});

