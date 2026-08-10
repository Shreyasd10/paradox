/**
 * Non-UI task control plane: admission leases, controllers, child execution.
 */

import type { Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { TaskEvent } from "./activity.ts";
import type { ChildRunOptions } from "./child-runner.ts";
import type { ThinkingLevel } from "./config.ts";
import type { ConcurrencyLease, ConcurrencyScheduler } from "./concurrency.ts";
import type { ChildExtensionCapability, ChildRunOutput, TaskRecord, TaskResult, TaskState } from "./types.ts";
import { emptyUsage } from "./types.ts";

export type ChildRunnerFn = (opts: ChildRunOptions) => Promise<ChildRunOutput>;

export interface TaskRunConfig {
	cwd: string;
	sessionPath: string;
	provider: string;
	model?: Model<any>;
	tools?: string[];
	childExtensions?: ChildExtensionCapability[];
	systemPrompt: string | null;
	task: string;
	timeoutMs: number;
	thinkingOverride?: ThinkingLevel;
	signal?: AbortSignal;
	maxTurns?: number;
	maxOutputTokens?: number;
	maxOutputTokensPerRequest?: number;
	resultHeadBytes?: number;
	resultTailBytes?: number;
}

export interface TaskRuntimeDeps {
	scheduler: ConcurrencyScheduler;
	runChild: ChildRunnerFn;
	writeRecord: (record: TaskRecord) => void;
	writeResult: (taskId: string, result: TaskResult) => void;
	onEvent?: (taskId: string, event: TaskEvent) => void;
	onTouch?: (record: TaskRecord) => void;
	/** Test seam — defaults to ModelRuntime.create. */
	createModelRuntime?: () => Promise<ModelRuntime>;
}

interface TrackedTask {
	controller: AbortController;
	lease: ConcurrencyLease | null;
	record: TaskRecord;
	/** True once terminal persistence finished. */
	settled: boolean;
}

function finalStateFromChild(result: ChildRunOutput): TaskState {
	if (result.interrupted) return "interrupted";
	if (result.timedOut) return "timed_out";
	if (result.limitReason && result.exitCode === 0) return "completed";
	if (result.exitCode === 0) return "completed";
	return "failed";
}

export class TaskRuntime {
	private readonly deps: TaskRuntimeDeps;
	private readonly active = new Map<string, TrackedTask>();
	private shuttingDown = false;
	private modelRuntimePromise: Promise<ModelRuntime> | null = null;

	constructor(deps: TaskRuntimeDeps) {
		this.deps = deps;
	}

	/** Lazy coalesced ModelRuntime; clears only on rejection so later tasks can retry. */
	getModelRuntime(): Promise<ModelRuntime> {
		if (!this.modelRuntimePromise) {
			const create = this.deps.createModelRuntime ?? (() => ModelRuntime.create());
			this.modelRuntimePromise = create().catch((err) => {
				this.modelRuntimePromise = null;
				throw err;
			});
		}
		return this.modelRuntimePromise;
	}

	get activeCount(): number {
		return this.active.size;
	}

	isActive(taskId: string): boolean {
		return this.active.has(taskId);
	}

	stopTask(taskId: string): boolean {
		const tracked = this.active.get(taskId);
		if (!tracked || tracked.settled) return false;
		tracked.controller.abort();
		return true;
	}

	shutdown(): void {
		this.shuttingDown = true;
		for (const tracked of this.active.values()) {
			tracked.controller.abort();
		}
		this.deps.scheduler.drain();
	}

	/**
	 * Persist queued state, start detached admission+execution, return immediately.
	 */
	startBackground(
		record: TaskRecord,
		config: TaskRunConfig,
	): { taskId: string; record: TaskRecord } {
		const controller = new AbortController();
		let current: TaskRecord = {
			...record,
			state: "queued",
			startedAt: null,
			background: true,
		};
		this.deps.writeRecord(current);
		this.active.set(record.id, {
			controller,
			lease: null,
			record: current,
			settled: false,
		});
		this.deps.onTouch?.(current);

		void this.runDetached(record.id, config);

		return { taskId: record.id, record: current };
	}

	/**
	 * Await admission and completion (foreground semantics).
	 */
	async runForeground(
		record: TaskRecord,
		config: TaskRunConfig,
		onPartial?: (text: string, record: TaskRecord) => void,
	): Promise<{ record: TaskRecord; output: string }> {
		const controller = new AbortController();
		if (config.signal) {
			if (config.signal.aborted) controller.abort();
			else config.signal.addEventListener("abort", () => controller.abort(), { once: true });
		}

		const tracked: TrackedTask = {
			controller,
			lease: null,
			record: { ...record, state: "queued", background: false },
			settled: false,
		};
		this.active.set(record.id, tracked);
		this.deps.writeRecord(tracked.record);
		this.deps.onTouch?.(tracked.record);

		try {
			if (this.shuttingDown || controller.signal.aborted) {
				return this.finishInterrupted(record.id, "Session shutting down or aborted before admission.");
			}

			let lease: ConcurrencyLease;
			try {
				lease = await this.deps.scheduler.acquire(config.provider, controller.signal);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const failed: TaskRecord = {
					...tracked.record,
					state: controller.signal.aborted ? "interrupted" : "failed",
					error: msg,
					exitCode: 1,
					completedAt: new Date().toISOString(),
					output: msg,
				};
				return this.persistTerminal(record.id, failed, null, false);
			}

			tracked.lease = lease;
			tracked.record = {
				...tracked.record,
				state: "running",
				startedAt: new Date().toISOString(),
			};
			this.deps.writeRecord(tracked.record);
			this.deps.onTouch?.(tracked.record);
			onPartial?.("(running...)", tracked.record);

			let result: ChildRunOutput;
			try {
				result = await this.invokeChild(config, controller.signal, record.id, () => {
					onPartial?.("", tracked.record);
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (controller.signal.aborted) {
					return this.finishInterrupted(record.id, message);
				}
				const failed: TaskRecord = {
					...tracked.record,
					state: "failed",
					exitCode: 1,
					output: message,
					error: message,
					truncated: false,
					usage: emptyUsage(),
					model: null,
					limitReason: null,
					completedAt: new Date().toISOString(),
				};
				return this.persistTerminal(record.id, failed, null, false);
			}

			const state = finalStateFromChild(result);
			const finalRecord: TaskRecord = {
				...tracked.record,
				state,
				exitCode: result.exitCode,
				output: result.output,
				error: result.exitCode !== 0 && !result.interrupted && !result.timedOut ? result.output : null,
				truncated: result.truncated,
				completedAt: new Date().toISOString(),
				usage: result.usage,
				model: result.model,
				limitReason: result.limitReason ?? null,
			};
			return this.persistTerminal(record.id, finalRecord, null, false);
		} finally {
			this.releaseLease(record.id);
			this.active.delete(record.id);
		}
	}

	
	private async invokeChild(
		config: TaskRunConfig,
		signal: AbortSignal,
		taskId: string,
		onEvent?: (ev: TaskEvent) => void,
	): Promise<ChildRunOutput> {
		const modelRuntime = await this.getModelRuntime();
		return this.deps.runChild({
			cwd: config.cwd,
			sessionPath: config.sessionPath,
			model: config.model,
			tools: config.tools,
			childExtensions: config.childExtensions,
			systemPrompt: config.systemPrompt,
			task: config.task,
			signal,
			timeoutMs: config.timeoutMs,
			thinkingOverride: config.thinkingOverride,
			modelRuntime,
			maxTurns: config.maxTurns,
			maxOutputTokens: config.maxOutputTokens,
			maxOutputTokensPerRequest: config.maxOutputTokensPerRequest,
			resultHeadBytes: config.resultHeadBytes,
			resultTailBytes: config.resultTailBytes,
			noExtensions: true,
			noSkills: true,
			onEvent: (ev) => {
				this.deps.onEvent?.(taskId, ev);
				onEvent?.(ev);
			},
		});
	}

	private async runDetached(taskId: string, config: TaskRunConfig): Promise<void> {
		const tracked = this.active.get(taskId);
		if (!tracked || tracked.settled) return;

		try {
			if (this.shuttingDown || tracked.controller.signal.aborted) {
				this.finishInterrupted(taskId, "Stopped before admission.");
				return;
			}

			let lease: ConcurrencyLease;
			try {
				lease = await this.deps.scheduler.acquire(config.provider, tracked.controller.signal);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const interrupted = tracked.controller.signal.aborted || /cancel|abort|shutting down/i.test(msg);
				const finalRecord: TaskRecord = {
					...tracked.record,
					state: interrupted ? "interrupted" : "failed",
					error: interrupted ? null : msg,
					output: interrupted ? "Stopped before admission." : msg,
					exitCode: 1,
					completedAt: new Date().toISOString(),
					usage: emptyUsage(),
				};
				this.persistTerminal(taskId, finalRecord, {
					taskId,
					state: finalRecord.state,
					output: finalRecord.output ?? "",
					error: finalRecord.error,
					sessionPath: finalRecord.sessionPath,
					exitCode: 1,
					truncated: false,
				}, true);
				return;
			}

			tracked.lease = lease;
			if (tracked.controller.signal.aborted) {
				lease.release();
				tracked.lease = null;
				this.finishInterrupted(taskId, "Stopped before start.");
				return;
			}

			tracked.record = {
				...tracked.record,
				state: "running",
				startedAt: new Date().toISOString(),
			};
			this.deps.writeRecord(tracked.record);
			this.deps.onTouch?.(tracked.record);

			let result: ChildRunOutput;
			try {
				result = await this.invokeChild(config, tracked.controller.signal, taskId);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const finalRecord: TaskRecord = {
					...tracked.record,
					state: tracked.controller.signal.aborted ? "interrupted" : "failed",
					error: msg,
					output: msg,
					exitCode: 1,
					completedAt: new Date().toISOString(),
				};
				this.persistTerminal(taskId, finalRecord, {
					taskId,
					state: finalRecord.state,
					output: msg,
					error: msg,
					sessionPath: finalRecord.sessionPath,
					exitCode: 1,
					truncated: false,
				}, true);
				return;
			}

			const state = finalStateFromChild(result);
			const finalRecord: TaskRecord = {
				...tracked.record,
				state,
				exitCode: result.exitCode,
				output: result.output,
				error: result.exitCode !== 0 && !result.interrupted && !result.timedOut ? result.output : null,
				truncated: result.truncated,
				completedAt: new Date().toISOString(),
				usage: result.usage,
				model: result.model,
			};
			finalRecord.limitReason = result.limitReason ?? null;
			this.persistTerminal(taskId, finalRecord, {
				taskId,
				state,
				output: result.output,
				error: finalRecord.error,
				sessionPath: finalRecord.sessionPath,
				exitCode: result.exitCode,
				truncated: result.truncated,
				limitReason: result.limitReason ?? null,
			}, true);
		} finally {
			this.releaseLease(taskId);
			const still = this.active.get(taskId);
			if (still?.settled) this.active.delete(taskId);
		}
	}

	private finishInterrupted(taskId: string, output: string): { record: TaskRecord; output: string } {
		const tracked = this.active.get(taskId);
		const base = tracked?.record ?? makeMinimalRecord(taskId);
		const finalRecord: TaskRecord = {
			...base,
			state: "interrupted",
			exitCode: 1,
			output,
			error: null,
			completedAt: new Date().toISOString(),
			usage: emptyUsage(),
		};
		return this.persistTerminal(
			taskId,
			finalRecord,
			{
				taskId,
				state: "interrupted",
				output,
				error: null,
				sessionPath: finalRecord.sessionPath,
				exitCode: 1,
				truncated: false,
			},
			Boolean(tracked?.record.background),
		);
	}

	private persistTerminal(
		taskId: string,
		finalRecord: TaskRecord,
		result: TaskResult | null,
		writeBackgroundResult: boolean,
	): { record: TaskRecord; output: string } {
		const tracked = this.active.get(taskId);
		if (tracked?.settled) {
			return { record: tracked.record, output: tracked.record.output ?? "" };
		}
		if (tracked) {
			tracked.settled = true;
			tracked.record = finalRecord;
		}
		this.deps.writeRecord(finalRecord);
		if (writeBackgroundResult && result) {
			this.deps.writeResult(taskId, result);
		}
		this.deps.onTouch?.(finalRecord);
		this.releaseLease(taskId);
		this.active.delete(taskId);
		return { record: finalRecord, output: finalRecord.output ?? "" };
	}

	private releaseLease(taskId: string): void {
		const tracked = this.active.get(taskId);
		if (!tracked?.lease) return;
		tracked.lease.release();
		tracked.lease = null;
	}
}

function makeMinimalRecord(taskId: string): TaskRecord {
	return {
		id: taskId,
		parentId: null,
		agent: "unknown",
		agentSource: "unknown",
		description: taskId,
		contextMode: "fresh",
		cwd: process.cwd(),
		state: "interrupted",
		background: true,
		createdAt: new Date().toISOString(),
		startedAt: null,
		completedAt: null,
		sessionPath: null,
		resultPath: null,
		exitCode: 1,
		output: null,
		error: null,
		truncated: false,
		usage: emptyUsage(),
		model: null,
	};
}
