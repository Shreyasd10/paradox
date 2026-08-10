import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { roster } from "../src/activity.ts";
import { emptyUsage, makeDescription, type TaskRecord } from "../src/types.ts";

function makeRecord(id: string, partial: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id,
		parentId: null,
		agent: "locator",
		agentSource: "user",
		description: "find auth files",
		contextMode: "fresh",
		cwd: "/tmp",
		state: "running",
		background: true,
		createdAt: new Date().toISOString(),
		startedAt: new Date().toISOString(),
		completedAt: null,
		sessionPath: `/tmp/${id}/session.jsonl`,
		resultPath: null,
		exitCode: null,
		output: null,
		error: null,
		truncated: false,
		usage: emptyUsage(),
		model: null,
		...partial,
	};
}

describe("activity roster", () => {
	beforeEach(() => {
		roster.clear();
	});

	it("upserts and lists tasks", () => {
		roster.upsert(makeRecord("t1"));
		roster.upsert(makeRecord("t2", { description: "second" }));
		assert.equal(roster.list().length, 2);
		assert.equal(roster.get("t1")?.record.agent, "locator");
	});

	it("tracks tool activity from stream events", () => {
		roster.upsert(makeRecord("t1"));
		roster.applyEvent("t1", { type: "tool_start", toolCallId: "c1", toolName: "read" });
		roster.applyEvent("t1", { type: "tool_start", toolCallId: "c2", toolName: "grep" });
		const a = roster.get("t1")!.activity;
		assert.equal(a.toolUses, 2);
		assert.equal(a.activeTools.size, 2);
		roster.applyEvent("t1", { type: "tool_end", toolCallId: "c1", toolName: "read" });
		assert.equal(a.activeTools.size, 1);
		assert.equal(a.activeTools.get("c2"), "grep");
	});

	it("increments turns on assistant message_end", () => {
		roster.upsert(makeRecord("t1"));
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 10, output: 5, cost: 0.01 },
		});
		const view = roster.get("t1")!;
		assert.equal(view.activity.turnCount, 1);
		assert.equal(view.record.usage.input, 10);
		assert.equal(view.record.usage.output, 5);
	});

	it("adds incremental usage events without double-counting cumulative totals", () => {
		roster.upsert(makeRecord("t1"));
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 100, output: 20 },
		});
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 80, output: 12 },
		});
		const usage = roster.get("t1")!.record.usage;
		assert.equal(usage.input, 180);
		assert.equal(usage.output, 32);
	});


	it("characterization: roster adds each usage payload (callers must emit deltas)", () => {
		// Documents add-semantics: feeding cumulative totals would double-count.
		roster.upsert(makeRecord("t1"));
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 100, output: 20 },
		});
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 180, output: 32 },
		});
		const usage = roster.get("t1")!.record.usage;
		assert.equal(usage.input, 280);
		assert.equal(usage.output, 52);
	});

	it("treats missing usage fields as zero", () => {
		roster.upsert(makeRecord("t1"));
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 10 },
		});
		const usage = roster.get("t1")!.record.usage;
		assert.equal(usage.input, 10);
		assert.equal(usage.output, 0);
		assert.equal(usage.cacheRead, 0);
		assert.equal(usage.cacheWrite, 0);
		assert.equal(usage.cost, 0);
	});

	it("final markFinished replaces live usage with authoritative totals", () => {
		roster.upsert(makeRecord("t1"));
		roster.applyEvent("t1", {
			type: "message_end",
			role: "assistant",
			usage: { input: 10, output: 5 },
		});
		const final = makeRecord("t1", {
			state: "completed",
			usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: 0.02, turns: 1 },
			completedAt: new Date().toISOString(),
		});
		roster.markFinished("t1", final);
		assert.deepEqual(roster.get("t1")!.record.usage, final.usage);
	});

	it("makeDescription truncates long prompts", () => {
		const short = makeDescription("hello");
		assert.equal(short, "hello");
		const long = makeDescription("x".repeat(100), 20);
		assert.ok(long.length <= 20);
		assert.ok(long.endsWith("…"));
	});
});
