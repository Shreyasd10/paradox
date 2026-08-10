import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyScheduler } from "../src/concurrency.ts";
import { TaskRuntime, type ChildRunnerFn } from "../src/task-runtime.ts";
import { emptyUsage, type TaskRecord, type TaskResult } from "../src/types.ts";

function stubModelRuntime() {
	return {
		createModelRuntime: async () => ({}) as any,
	};
}


function makeRecord(id: string, partial: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id,
		parentId: "parent",
		agent: "locator",
		agentSource: "user",
		description: "test",
		contextMode: "fresh",
		cwd: "/tmp",
		state: "queued",
		background: true,
		createdAt: new Date().toISOString(),
		startedAt: null,
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

describe("TaskRuntime", () => {
	let records: TaskRecord[];
	let results: TaskResult[];
	let childStarts: number;
	let releaseChild: (() => void) | null;
	let childInvocations: Parameters<ChildRunnerFn>[0][];
	let runtime: TaskRuntime;

	beforeEach(() => {
		records = [];
		results = [];
		childStarts = 0;
		releaseChild = null;
		childInvocations = [];

		const fakeChild: ChildRunnerFn = async (opts) => {
			childInvocations.push(opts);
			childStarts++;
			await new Promise<void>((resolve, reject) => {
				releaseChild = resolve;
				if (opts.signal?.aborted) {
					reject(new Error("aborted"));
					return;
				}
				opts.signal?.addEventListener(
					"abort",
					() => reject(new Error("aborted")),
					{ once: true },
				);
			}).catch(() => {});
			const interrupted = Boolean(opts.signal?.aborted);
			return {
				exitCode: interrupted ? 1 : 0,
				output: interrupted ? "stopped" : "done",
				stderr: "",
				usage: emptyUsage(),
				model: "test-model",
				interrupted,
				timedOut: false,
				truncated: false,
			};
		};

		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 5,
				maxQueued: 8,
				providerConcurrency: {},
			}),
			runChild: fakeChild,
			createModelRuntime: async () => ({}) as any,
			writeRecord: (r) => {
				records = records.filter((x) => x.id !== r.id);
				records.push({ ...r });
			},
			writeResult: (_id, r) => {
				results.push({ ...r });
			},
		});
	});

	it("returns five background acks before any child completes", async () => {
		const acks: string[] = [];
		const start = Date.now();
		for (let i = 0; i < 5; i++) {
			const record = makeRecord(`t${i}`);
			const ack = runtime.startBackground(record, {
				cwd: "/tmp",
				sessionPath: record.sessionPath!,
				provider: "openai",
				model: undefined,
				tools: [],
				systemPrompt: null,
				task: "work",
				timeoutMs: 0,
			});
			acks.push(ack.taskId);
		}
		const ackMs = Date.now() - start;
		assert.equal(acks.length, 5);
		assert.ok(ackMs < 50, `acks took ${ackMs}ms`);
		// Children may have started (admitted) but none completed — releaseChild still held
		assert.equal(results.length, 0);
		assert.ok(childStarts <= 5);
		runtime.shutdown();
	});

	it("keeps a sixth same-provider task queued when provider cap is 5", async () => {
		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 5,
				maxQueued: 8,
				providerConcurrency: { openai: 5 },
			}),
			createModelRuntime: async () => ({}) as any,
			runChild: async (opts) => {
				childStarts++;
				await new Promise<void>((resolve) => {
					releaseChild = resolve;
					opts.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return {
					exitCode: 0,
					output: "done",
					stderr: "",
					usage: emptyUsage(),
					model: null,
					interrupted: false,
					timedOut: false,
					truncated: false,
				};
			},
			writeRecord: (r) => {
				records = records.filter((x) => x.id !== r.id);
				records.push({ ...r });
			},
			writeResult: (_id, r) => results.push({ ...r }),
		});

		for (let i = 0; i < 6; i++) {
			runtime.startBackground(makeRecord(`t${i}`), {
				cwd: "/tmp",
				sessionPath: `/tmp/t${i}/session.jsonl`,
				provider: "openai",
				model: undefined,
				tools: [],
				systemPrompt: null,
				task: "work",
				timeoutMs: 0,
			});
		}
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(childStarts, 5);
		const sixth = records.find((r) => r.id === "t5");
		assert.ok(sixth);
		assert.equal(sixth!.state, "queued");
		runtime.shutdown();
	});

	it("stopping a queued task prevents child invocation and writes interrupted", async () => {
		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 1,
				maxQueued: 8,
				providerConcurrency: {},
			}),
			createModelRuntime: async () => ({}) as any,
			runChild: async () => {
				childStarts++;
				return {
					exitCode: 0,
					output: "done",
					stderr: "",
					usage: emptyUsage(),
					model: null,
					interrupted: false,
					timedOut: false,
					truncated: false,
				};
			},
			writeRecord: (r) => {
				records = records.filter((x) => x.id !== r.id);
				records.push({ ...r });
			},
			writeResult: (_id, r) => results.push({ ...r }),
		});

		// Hold the only slot with a hanging child
		let releaseFirst: (() => void) | undefined;
		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 1,
				maxQueued: 8,
				providerConcurrency: {},
			}),
			createModelRuntime: async () => ({}) as any,
			runChild: async (opts) => {
				childStarts++;
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
					opts.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return {
					exitCode: opts.signal?.aborted ? 1 : 0,
					output: "done",
					stderr: "",
					usage: emptyUsage(),
					model: null,
					interrupted: Boolean(opts.signal?.aborted),
					timedOut: false,
					truncated: false,
				};
			},
			writeRecord: (r) => {
				records = records.filter((x) => x.id !== r.id);
				records.push({ ...r });
			},
			writeResult: (_id, r) => results.push({ ...r }),
		});

		runtime.startBackground(makeRecord("hold"), {
			cwd: "/tmp",
			sessionPath: "/tmp/hold/session.jsonl",
			provider: "openai",
			model: undefined,
			tools: [],
			systemPrompt: null,
			task: "hold",
			timeoutMs: 0,
		});
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(childStarts, 1);

		runtime.startBackground(makeRecord("queued"), {
			cwd: "/tmp",
			sessionPath: "/tmp/queued/session.jsonl",
			provider: "openai",
			model: undefined,
			tools: [],
			systemPrompt: null,
			task: "queued",
			timeoutMs: 0,
		});
		await new Promise((r) => setTimeout(r, 10));
		assert.ok(runtime.stopTask("queued"));
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(childStarts, 1);
		const queuedResult = results.find((r) => r.taskId === "queued");
		assert.ok(queuedResult);
		assert.equal(queuedResult!.state, "interrupted");
		assert.equal(queuedResult!.exitCode, 1);
		releaseFirst?.();
		runtime.shutdown();
	});

	it("releases all leases on shutdown", async () => {
		const scheduler = new ConcurrencyScheduler({
			maxConcurrent: 2,
			maxQueued: 8,
			providerConcurrency: {},
		});
		runtime = new TaskRuntime({
			scheduler,
			createModelRuntime: async () => ({}) as any,
			runChild: async (opts) => {
				await new Promise<void>((resolve) => {
					opts.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return {
					exitCode: 1,
					output: "stopped",
					stderr: "",
					usage: emptyUsage(),
					model: null,
					interrupted: true,
					timedOut: false,
					truncated: false,
				};
			},
			writeRecord: (r) => {
				records = records.filter((x) => x.id !== r.id);
				records.push({ ...r });
			},
			writeResult: (_id, r) => results.push({ ...r }),
		});
		runtime.startBackground(makeRecord("a"), {
			cwd: "/tmp",
			sessionPath: "/tmp/a/session.jsonl",
			provider: "openai",
			model: undefined,
			tools: [],
			systemPrompt: null,
			task: "a",
			timeoutMs: 0,
		});
		runtime.startBackground(makeRecord("b"), {
			cwd: "/tmp",
			sessionPath: "/tmp/b/session.jsonl",
			provider: "openai",
			model: undefined,
			tools: [],
			systemPrompt: null,
			task: "b",
			timeoutMs: 0,
		});
		await new Promise((r) => setTimeout(r, 10));
		runtime.shutdown();
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(scheduler.activeCount, 0);
		assert.equal(scheduler.queuedCount, 0);
	});

	it("forwards child extension capabilities unchanged in foreground runs", async () => {
		const record = makeRecord("advisor-foreground", {
			background: false,
			childExtensions: ["advisor", "advisor"],
		});
		const run = runtime.runForeground(record, {
			cwd: "/tmp",
			sessionPath: record.sessionPath!,
			provider: "openai",
			tools: ["read", "advisor"],
			systemPrompt: null,
			task: "work",
			timeoutMs: 0,
			childExtensions: record.childExtensions,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.deepEqual(childInvocations[0]?.childExtensions, ["advisor", "advisor"]);
		releaseChild?.();
		const completed = await run;
		assert.deepEqual(completed.record.childExtensions, ["advisor", "advisor"]);
	});

	it("persists and forwards child extension capabilities in background runs", async () => {
		const record = makeRecord("advisor-background", {
			childExtensions: ["advisor", "advisor"],
		});
		runtime.startBackground(record, {
			cwd: "/tmp",
			sessionPath: record.sessionPath!,
			provider: "openai",
			tools: ["read", "advisor"],
			systemPrompt: null,
			task: "work",
			timeoutMs: 0,
			childExtensions: record.childExtensions,
		});
		assert.deepEqual(records.find((item) => item.id === record.id)?.childExtensions, ["advisor", "advisor"]);
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.deepEqual(childInvocations[0]?.childExtensions, ["advisor", "advisor"]);
		releaseChild?.();
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.deepEqual(records.find((item) => item.id === record.id)?.childExtensions, ["advisor", "advisor"]);
	});

	it("clears stale per-run metadata on resumed child startup rejection", async () => {
		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 1,
				maxQueued: 1,
				providerConcurrency: {},
			}),
			createModelRuntime: async () => ({}) as any,
			runChild: async () => {
				throw new Error("Advisor startup failed");
			},
			writeRecord: (next) => {
				records = records.filter((item) => item.id !== next.id);
				records.push({ ...next });
			},
			writeResult: (_id, result) => results.push({ ...result }),
		});
		const record = makeRecord("advisor-foreground-startup", {
			background: false,
			childExtensions: ["advisor", "advisor"],
			usage: { ...emptyUsage(), input: 100, output: 50, turns: 2 },
			model: "old-model",
			truncated: true,
			limitReason: "output",
		});

		const completed = await runtime.runForeground(record, {
			cwd: "/tmp",
			sessionPath: record.sessionPath!,
			provider: "openai",
			tools: ["advisor"],
			systemPrompt: null,
			task: "work",
			timeoutMs: 0,
			childExtensions: record.childExtensions,
		});

		assert.equal(completed.record.state, "failed");
		assert.equal(completed.record.exitCode, 1);
		assert.equal(completed.record.output, "Advisor startup failed");
		assert.equal(completed.record.error, "Advisor startup failed");
		assert.equal(completed.record.truncated, false);
		assert.deepEqual(completed.record.usage, emptyUsage());
		assert.equal(completed.record.model, null);
		assert.equal(completed.record.limitReason, null);
		assert.ok(completed.record.completedAt);
		assert.deepEqual(completed.record.childExtensions, ["advisor", "advisor"]);
		assert.equal(records.find((item) => item.id === record.id)?.state, "failed");
		assert.equal(runtime.activeCount, 0);
		assert.deepEqual(results, []);
	});

	it("keeps aborted foreground startup rejection interrupted", async () => {
		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 1,
				maxQueued: 1,
				providerConcurrency: {},
			}),
			createModelRuntime: async () => ({}) as any,
			runChild: async (options) => new Promise((_resolve, reject) => {
				options.signal?.addEventListener(
					"abort",
					() => reject(new Error("startup aborted")),
					{ once: true },
				);
			}),
			writeRecord: (next) => {
				records = records.filter((item) => item.id !== next.id);
				records.push({ ...next });
			},
			writeResult: (_id, result) => results.push({ ...result }),
		});
		const signal = new AbortController();
		const record = makeRecord("advisor-foreground-aborted", {
			background: false,
			childExtensions: ["advisor"],
		});
		const run = runtime.runForeground(record, {
			cwd: "/tmp",
			sessionPath: record.sessionPath!,
			provider: "openai",
			tools: ["advisor"],
			systemPrompt: null,
			task: "work",
			timeoutMs: 0,
			childExtensions: record.childExtensions,
			signal: signal.signal,
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		signal.abort();
		const completed = await run;

		assert.equal(completed.record.state, "interrupted");
		assert.equal(completed.record.exitCode, 1);
		assert.equal(completed.record.output, "startup aborted");
		assert.equal(completed.record.error, null);
		assert.ok(completed.record.completedAt);
		assert.deepEqual(completed.record.childExtensions, ["advisor"]);
		assert.equal(runtime.activeCount, 0);
		assert.deepEqual(results, []);
	});

	it("persists background child startup rejection and ordinary result", async () => {
		runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 1,
				maxQueued: 1,
				providerConcurrency: {},
			}),
			createModelRuntime: async () => ({}) as any,
			runChild: async () => {
				throw new Error("Advisor startup failed");
			},
			writeRecord: (next) => {
				records = records.filter((item) => item.id !== next.id);
				records.push({ ...next });
			},
			writeResult: (_id, result) => results.push({ ...result }),
		});
		const record = makeRecord("advisor-background-startup", {
			childExtensions: ["advisor", "advisor"],
		});

		runtime.startBackground(record, {
			cwd: "/tmp",
			sessionPath: record.sessionPath!,
			provider: "openai",
			tools: ["advisor"],
			systemPrompt: null,
			task: "work",
			timeoutMs: 0,
			childExtensions: record.childExtensions,
		});
		for (let attempt = 0; attempt < 50 && runtime.activeCount > 0; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		const failed = records.find((item) => item.id === record.id);
		assert.equal(failed?.state, "failed");
		assert.equal(failed?.exitCode, 1);
		assert.equal(failed?.output, "Advisor startup failed");
		assert.equal(failed?.error, "Advisor startup failed");
		assert.ok(failed?.completedAt);
		assert.deepEqual(failed?.childExtensions, ["advisor", "advisor"]);
		assert.equal(results.length, 1);
		assert.equal(results[0]?.taskId, record.id);
		assert.equal(results[0]?.state, "failed");
		assert.equal(results[0]?.output, "Advisor startup failed");
		assert.equal(results[0]?.error, "Advisor startup failed");
		assert.equal(runtime.activeCount, 0);
	});

	it("coalesces one ModelRuntime across concurrent children and retries after failure", async () => {
		let creates = 0;
		let failOnce = true;
		const runtime = new TaskRuntime({
			scheduler: new ConcurrencyScheduler({
				maxConcurrent: 5,
				maxQueued: 8,
				providerConcurrency: {},
			}),
			createModelRuntime: async () => {
				creates++;
				if (failOnce) {
					failOnce = false;
					throw new Error("init failed");
				}
				return { id: creates } as any;
			},
			runChild: async () => ({
				exitCode: 0,
				output: "ok",
				stderr: "",
				usage: emptyUsage(),
				model: null,
				interrupted: false,
				timedOut: false,
				truncated: false,
			}),
			writeRecord: () => {},
			writeResult: () => {},
		});

		await assert.rejects(() => runtime.getModelRuntime(), /init failed/);
		const a = runtime.getModelRuntime();
		const b = runtime.getModelRuntime();
		assert.equal(a, b);
		assert.equal(await a, await b);
		assert.equal(creates, 2);
	});

});
