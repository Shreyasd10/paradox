/**
 * pi-task — a small, reliable Pi-native subagent framework.
 *
 * One `task` tool backed by a minimal runtime for isolated child sessions.
 * Supports foreground execution, background execution, stable task identity,
 * cancellation, resume, and structured completion results.
 *
 * Primary behavioral benchmark: the official Pi subagent example
 * (examples/extensions/subagent/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { roster } from "./activity.ts";
import { discoverAgents, type AgentConfig } from "./agents.ts";
import { deriveChildTools, runChild } from "./child-runner.ts";
import {
	loadPiTaskConfig,
	resolveTaskPolicy,
	resolveThinkingLevel,
	type PiTaskConfig,
	type ThinkingLevel,
	type ThinkingPolicy,
} from "./config.ts";
import { ConcurrencyScheduler } from "./concurrency.ts";
import { TaskRuntime } from "./task-runtime.ts";
import { createForkSession } from "./fork-context.ts";
import { resolveHostAgentDir } from "./host-paths.ts";
import { createResultWatcher, type ResultWatcher } from "./result-watcher.ts";
import {
	deriveChildSessionPath,
	deleteResult,
	ensureTaskDir,
	generateTaskId,
	readRecord,
	writeRecord,
	writeResult,
} from "./task-state.ts";
import {
	CHILD_EXTENSION_CAPABILITIES,
	type AgentScope,
	type ContextMode,
	type ChildExtensionCapability,
	emptyUsage,
	makeDescription,
	type TaskPolicySnapshot,
	type TaskRecord,
	type TaskResult,
	type TaskState,
	type WidgetMode,
} from "./types.ts";
import { describeActivity } from "./ui/format.ts";
import { FleetList } from "./ui/fleet-list.ts";
import { TaskWidget } from "./ui/task-widget.ts";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Resolve agent model: "inherit" → parent's current model, explicit name → as-is.
 */
function resolveModel(
	agentModel: string | undefined,
	ctxModel: Model<any> | undefined,
	modelRegistry: { find(provider: string, modelId: string): Model<any> | undefined },
): Model<any> | undefined {
	if (!agentModel || agentModel === "inherit") return ctxModel;
	const slash = agentModel.indexOf("/");
	if (slash === -1) return ctxModel;
	return modelRegistry.find(agentModel.slice(0, slash), agentModel.slice(slash + 1)) ?? ctxModel;
}

interface RuntimeState {
	runtime: TaskRuntime;
	config: PiTaskConfig;
	configDiagnostics: string[];
	watcher: ResultWatcher | null;
	sessionId: string | null;
	widget: TaskWidget | null;
	fleet: FleetList | null;
	widgetMode: WidgetMode;
	fleetEnabled: boolean;
}

function createRuntime(config: PiTaskConfig): TaskRuntime {
	return new TaskRuntime({
		scheduler: new ConcurrencyScheduler({
			maxConcurrent: config.maxConcurrent,
			maxQueued: config.maxQueued,
			providerConcurrency: config.providerConcurrency,
		}),
		runChild,
		writeRecord,
		writeResult,
		onEvent: (taskId, ev) => {
			roster.applyEvent(taskId, ev);
			const view = roster.get(taskId);
			if (view) {
				roster.upsert({ ...view.record, usage: { ...view.record.usage } }, view.activity);
			}
			state.widget?.update();
			state.fleet?.update();
		},
		onTouch: (record) => touchUi(record),
	});
}

function createState(): RuntimeState {
	const loaded = loadPiTaskConfig();
	return {
		runtime: null as unknown as TaskRuntime,
		config: loaded.config,
		configDiagnostics: loaded.diagnostics.map((d) => d.message),
		watcher: null,
		sessionId: null,
		widget: null,
		fleet: null,
		widgetMode: "background",
		fleetEnabled: true,
	};
}

let state: RuntimeState = createState();
state.runtime = createRuntime(state.config);

function stopTask(taskId: string): boolean {
	return state.runtime.stopTask(taskId);
}

function touchUi(record: TaskRecord): void {
	roster.upsert(record);
	if (record.state !== "running" && record.state !== "queued") {
		state.widget?.markFinished(record.id);
		state.fleet?.onTaskFinished(record.id);
	}
	state.widget?.update();
	state.fleet?.update();
}

function formatUsage(usage: ReturnType<typeof emptyUsage>): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${usage.input}`);
	if (usage.output) parts.push(`↓${usage.output}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	return parts.join(" ");
}

// --- Tool schema ---

const ThinkingParam = StringEnum(
	["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
	{ description: "Thinking level (default: inherit from config/parent)" },
);

const TaskParams = Type.Object({
	agent: Type.String({ description: "Agent name" }),
	task: Type.String({ description: "Task prompt" }),
	cwd: Type.Optional(Type.String({ description: "Working directory" })),
	task_id: Type.Optional(Type.String({ description: "Resume prior task" })),
	background: Type.Optional(Type.Boolean({ description: "Run async" })),
	context: Type.Optional(
		StringEnum(["fresh", "fork"], { description: "Context mode (default: fresh)" }),
	),
	agent_scope: Type.Optional(
		StringEnum(["user", "project", "both"], { description: "Agent scope (default: user)" }),
	),
	child_extensions: Type.Optional(
		Type.Array(
			StringEnum([...CHILD_EXTENSION_CAPABILITIES], { description: "Allowed child extension" }),
			{ description: "Explicit child extension capabilities; currently only advisor" },
		),
	),
	max_turns: Type.Optional(
		Type.Integer({ minimum: 0, description: "Max completed turns (0 disables; default from config)" }),
	),
	max_output_tokens: Type.Optional(
		Type.Integer({ minimum: 0, description: "Max total output tokens (0 disables; default from config)" }),
	),
	thinking: Type.Optional(ThinkingParam),
});

interface TaskDetails {
	taskId: string;
	agent: string;
	agentSource: string;
	state: TaskState;
	background: boolean;
	output: string;
	error: string | null;
	sessionPath: string | null;
	usage: ReturnType<typeof emptyUsage>;
}

// --- Extension entry point ---


function wireTaskActions(): void {
	if (!state.widget || !state.fleet) return;
	state.widget.setActions({
		onStop: stopTask,
		onOpen: (view) => state.fleet?.openConversationViewer(view),
		notify: (message, type) => {
			/* notify only available when UI ctx is set; fleet/widget use their own */
			void message;
			void type;
		},
	});
}

export default function (pi: ExtensionAPI) {
	// TUI surfaces (widget above editor, fleet below)
	state.widget = new TaskWidget(() => state.widgetMode);
	state.fleet = new FleetList(stopTask);
	state.fleet.setEnabled(state.fleetEnabled);
	wireTaskActions();

	// Lifecycle: start watcher on session_start, stop on shutdown
	pi.on("session_start", (_event, ctx) => {
		state.sessionId = ctx.sessionManager.getSessionId?.() ?? null;
		if (!state.watcher) {
			state.watcher = createResultWatcher(pi, () => state.sessionId);
			state.watcher.start();
		}
		// Recreate TUI surfaces after a prior session_shutdown dispose
		if (!state.widget) {
			state.widget = new TaskWidget(() => state.widgetMode);
		}
		if (!state.fleet) {
			state.fleet = new FleetList(stopTask);
			state.fleet.setEnabled(state.fleetEnabled);
		}
		wireTaskActions();
		if (ctx.ui) {
			state.widget?.setUICtx(ctx.ui as never);
			state.fleet?.setUICtx(ctx.ui as unknown as never);
			state.widget?.setActions({
				onStop: stopTask,
				onOpen: (view) => state.fleet?.openConversationViewer(view),
				notify: (message, type) => ctx.ui?.notify?.(message, type),
			});
			for (const message of state.configDiagnostics) {
				ctx.ui.notify?.(message, "warning");
			}
			state.configDiagnostics = [];
		}
	});

	pi.on("session_shutdown", () => {
		state.watcher?.stop();
		state.watcher = null;
		state.widget?.dispose();
		state.fleet?.dispose();
		state.widget = null;
		state.fleet = null;
		state.runtime.shutdown();
		roster.clear();
		// Recreate runtime for a future session_start
		state.runtime = createRuntime(state.config);
	});

	// Grab UI context + age finished rows on each parent tool start
	pi.on("tool_execution_start", async (_event, ctx) => {
		if (ctx.ui) {
			state.widget?.setUICtx(ctx.ui as never);
			state.fleet?.setUICtx(ctx.ui as unknown as never);
			state.widget?.setActions({
				onStop: stopTask,
				onOpen: (view) => state.fleet?.openConversationViewer(view),
				notify: (message, type) => ctx.ui?.notify?.(message, type),
			});
			state.widget?.onTurnStart();
		}
	});

	// Completion messages stay in model context; task surfaces own their TUI status.
	pi.registerMessageRenderer(
		"pi-task-notification",
		() => emptyToolUi(),
	);

	// /tasks interactive menu
	pi.registerCommand("tasks", {
		description: "Manage pi-task subagents (list, view, stop, settings)",
		handler: async (_args, ctx) => {
			await openTasksMenu(ctx);
		},
	});


/** Task activity is visible through the widget, FleetView, and conversation viewer. */
function emptyToolUi(): { render(): string[]; invalidate(): void } {
	return {
		render: () => [],
		invalidate() {},
	};
}

	pi.registerTool({
		name: "task",
		label: "Task",
		description: [
			"Delegate a task to a specialized subagent with an isolated context window.",
			`Agents are discovered from ${path.join(resolveHostAgentDir(), "agents")} by default.`,
			'Use agent_scope: "project" or "both" to include project-local agents (.pi/agents).',
			"Set background: true for async work; you will be notified on completion.",
			"Pass task_id to resume a prior task.",
			"Use /tasks for the interactive task manager. ↓/← at empty prompt opens FleetView.",
		].join(" "),
		parameters: TaskParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (ctx.ui) {
				state.widget?.setUICtx(ctx.ui as never);
				state.fleet?.setUICtx(ctx.ui as unknown as never);
				state.widget?.setActions({
					onStop: stopTask,
					onOpen: (view) => state.fleet?.openConversationViewer(view),
					notify: (message, type) => ctx.ui?.notify?.(message, type),
				});
			}

			const agentScope = (params.agent_scope ?? "user") as AgentScope;
			const confirmProjectAgents = true; // always confirm in interactive mode
			const cwd = params.cwd ?? ctx.cwd;
			const discovery = discoverAgents(cwd, agentScope);
			const agents = discovery.agents;

			// --- Resume path (R14, F3) ---
			if (params.task_id) {
				const existingRecord = readRecord(params.task_id);
				if (!existingRecord) {
					return {
						content: [{ type: "text", text: `Unknown task_id: ${params.task_id}. No persisted task record found.` }],
						details: {},
					};
				}

				// Reject if already running
				if (state.runtime.isActive(params.task_id)) {
					return {
						content: [{ type: "text", text: `Task ${params.task_id} is already running. Cancel or wait for it first.` }],
						details: {},
					};
				}

				if (!existingRecord.sessionPath || !fs.existsSync(existingRecord.sessionPath)) {
					return {
						content: [{ type: "text", text: `Cannot resume task ${params.task_id}: session file is missing.` }],
						details: {},
					};
				}

				const agent = agents.find((a) => a.name === existingRecord.agent);
				if (!agent) {
					return {
						content: [{ type: "text", text: `Agent "${existingRecord.agent}" is no longer available for task ${params.task_id}.` }],
						details: {},
					};
				}

				// Resume: append follow-up to same session
				// A previous undelivered completion belongs to the old run.
				deleteResult(params.task_id);
				const resumeModel = resolveModel(agent.model, ctx.model, ctx.modelRegistry);
				return runForegroundResume(pi, agent, existingRecord, params.task, ctx, signal, onUpdate, undefined, resumeModel);
			}

			// --- New task path ---
			const agent = agents.find((a) => a.name === params.agent);
			if (!agent) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [{ type: "text", text: `Unknown agent: "${params.agent}". Available agents: ${available}` }],
					details: {},
				};
			}

			// Project-agent trust gate (R2, AE9)
			if ((agentScope === "project" || agentScope === "both") && agent.source === "project" && confirmProjectAgents && ctx.hasUI) {
				const dir = discovery.projectAgentsDir ?? "(unknown)";
				const ok = await ctx.ui.confirm(
					"Run project-local agent?",
					`Agent: ${agent.name}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
				);
				if (!ok) {
					return {
						content: [{ type: "text", text: "Canceled: project-local agent not approved." }],
						details: {},
					};
				}
			}

			const background = params.background === true;
			const contextMode: ContextMode = params.context === "fork" ? "fork" : "fresh";
			const taskId = generateTaskId();
			const parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
			const parentSessionId = ctx.sessionManager.getSessionId?.() ?? null;
			const sessionPath = deriveChildSessionPath(parentSessionFile, taskId);
			const timeoutMs = DEFAULT_TIMEOUT_MS;

			// Determine child tools (R7)
			const childExtensions = params.child_extensions as ChildExtensionCapability[] | undefined;
			const childTools = deriveChildTools(agent.tools, false, childExtensions);

			// Resolve model: "inherit" → parent's current model, explicit → as-is
			const resolvedModel = resolveModel(agent.model, ctx.model, ctx.modelRegistry);

			// Determine system prompt
			const systemPrompt = agent.systemPrompt?.trim() || null;

			// Fork context (R6)
			let effectiveSessionPath = sessionPath;
			let forkForcedOff = false;
			if (contextMode === "fork") {
				try {
					const fork = createForkSession(ctx.sessionManager as never);
					effectiveSessionPath = fork.sessionFile;
					forkForcedOff = fork.thinkingOverride === "off";
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					// Fallback to sanitized summary via --append-system-prompt (R6)
					console.error(`Fork failed, falling back to fresh: ${msg}`);
					effectiveSessionPath = sessionPath; // fresh fallback
				}
			}

			const resolvedPolicy = resolveTaskPolicy(state.config, {
				maxTurns: params.max_turns,
				maxOutputTokens: params.max_output_tokens,
				thinking: params.thinking as ThinkingPolicy | undefined,
			});
			const parentThinking = (pi.getThinkingLevel?.() ?? "off") as ThinkingLevel;
			const resolvedThinking = resolveThinkingLevel(
				resolvedPolicy.thinking,
				parentThinking,
				forkForcedOff,
			);
			const policy: TaskPolicySnapshot = {
				maxTurns: resolvedPolicy.maxTurns,
				maxOutputTokens: resolvedPolicy.maxOutputTokens,
				maxOutputTokensPerRequest: resolvedPolicy.maxOutputTokensPerRequest,
				thinking: resolvedPolicy.thinking,
				resolvedThinking,
				resultHeadBytes: resolvedPolicy.resultHeadBytes,
				resultTailBytes: resolvedPolicy.resultTailBytes,
			};

			const record: TaskRecord = {
				id: taskId,
				parentId: parentSessionId,
				agent: agent.name,
				agentSource: agent.source,
				description: makeDescription(params.task),
				contextMode,
				cwd,
				state: "queued",
				background,
				createdAt: new Date().toISOString(),
				startedAt: null,
				completedAt: null,
				sessionPath: effectiveSessionPath,
				resultPath: null,
				exitCode: null,
				output: null,
				error: null,
				truncated: false,
				usage: emptyUsage(),
				model: null,
				...(childExtensions !== undefined ? { childExtensions } : {}),
				policy,
			};
			ensureTaskDir(taskId);
			writeRecord(record);
			roster.upsert(record);
			state.widget?.update();
			state.fleet?.update();

			if (background) {
				return runBackground(pi, agent, record, {
					cwd,
					sessionPath: effectiveSessionPath,
					model: resolvedModel,
					tools: childTools,
					systemPrompt,
					task: params.task,
					timeoutMs,
					thinkingOverride: resolvedThinking,
				}, onUpdate);
			}

			return runForeground(pi, agent, record, {
				cwd,
				sessionPath: effectiveSessionPath,
				model: resolvedModel,
				tools: childTools,
				systemPrompt,
				task: params.task,
				signal,
				timeoutMs,
				thinkingOverride: resolvedThinking,
			}, onUpdate);
		},

		renderShell: "self",

		renderCall() {
			return emptyToolUi();
		},

		renderResult() {
			return emptyToolUi();
		},
	});
}

// --- TUI helpers ---

async function openTasksMenu(ctx: {
	ui?: {
		select(title: string, options: string[]): Promise<string | undefined>;
		notify(message: string, type?: "info" | "warning" | "error"): void;
	};
	hasUI?: boolean;
}): Promise<void> {
	const ui = ctx.ui;
	if (!ui?.select) return;
	state.fleet?.setUICtx(ui as never);

	const views = roster.list();
	const running = views.filter((v) => v.record.state === "running" || v.record.state === "queued");
	const done = views.filter((v) => v.record.state !== "running" && v.record.state !== "queued");

	const options = [
		`Running (${running.length})`,
		`Recent finished (${done.length})`,
		`Widget: ${state.widgetMode}`,
		`Fleet view: ${state.fleetEnabled ? "on" : "off"}`,
		"Stop a running task",
	];
	const choice = await ui.select("Tasks", options);
	if (!choice) return;

	if (choice.startsWith("Running") || choice.startsWith("Recent")) {
		const list = choice.startsWith("Running") ? running : done.slice(-20).reverse();
		if (list.length === 0) {
			ui.notify("No tasks in this list.", "info");
			return;
		}
		const labels = list.map(
			(v) =>
				`${v.record.agent} · ${v.record.description} · ${v.record.state} · ${v.record.id}`,
		);
		const picked = await ui.select("Select task", labels);
		if (!picked) return;
		const idx = labels.indexOf(picked);
		const view = list[idx];
		if (!view || !state.fleet) {
			ui.notify(view ? `${view.record.id}: ${view.record.state}` : "Not found", "info");
			return;
		}
		state.fleet.openConversationViewer(view);
		return;
	}

	if (choice.startsWith("Widget:")) {
		const next = await ui.select("Widget mode", ["background", "all", "off"]);
		if (next === "background" || next === "all" || next === "off") {
			state.widgetMode = next;
			state.widget?.update();
			ui.notify(`Widget set to ${next}`, "info");
		}
		return;
	}

	if (choice.startsWith("Fleet view:")) {
		state.fleetEnabled = !state.fleetEnabled;
		state.fleet?.setEnabled(state.fleetEnabled);
		ui.notify(`Fleet view ${state.fleetEnabled ? "enabled" : "disabled"}`, "info");
		return;
	}

	if (choice.startsWith("Stop")) {
		if (running.length === 0) {
			ui.notify("No running tasks.", "info");
			return;
		}
		const labels = running.map((v) => `${v.record.agent} · ${v.record.description} · ${v.record.id}`);
		const picked = await ui.select("Stop task", labels);
		if (!picked) return;
		const idx = labels.indexOf(picked);
		const view = running[idx];
		if (view && stopTask(view.record.id)) {
			ui.notify(`Stopped "${view.record.description}".`, "info");
		}
	}
}

// --- Foreground execution (F1) ---

interface RunConfig {
	cwd: string;
	sessionPath: string;
	model?: Model<any>;
	tools?: string[];
	systemPrompt: string | null;
	task: string;
	signal: AbortSignal | undefined;
	timeoutMs: number;
	thinkingOverride?: ThinkingLevel;
}

async function runForeground(
	_pi: ExtensionAPI,
	agent: AgentConfig,
	record: TaskRecord,
	config: RunConfig,
	onUpdate: ((partial: AgentToolResult<TaskDetails>) => void) | undefined,
): Promise<AgentToolResult<TaskDetails>> {
	const provider = config.model?.provider ?? "unknown";
	state.widget?.ensureTimer();
	state.fleet?.ensureTimer();

	const { record: finalRecord, output } = await state.runtime.runForeground(
		record,
		{
			cwd: config.cwd,
			sessionPath: config.sessionPath,
			provider,
			model: config.model,
			tools: config.tools,
			childExtensions: record.childExtensions,
			systemPrompt: config.systemPrompt,
			task: config.task,
			timeoutMs: config.timeoutMs,
			thinkingOverride: config.thinkingOverride ?? record.policy?.resolvedThinking,
			signal: config.signal,
			maxTurns: record.policy?.maxTurns,
			maxOutputTokens: record.policy?.maxOutputTokens,
			maxOutputTokensPerRequest: record.policy?.maxOutputTokensPerRequest,
			resultHeadBytes: record.policy?.resultHeadBytes,
			resultTailBytes: record.policy?.resultTailBytes,
		},
		(text, live) => {
			if (!onUpdate) return;
			const view = roster.get(live.id);
			const body = text || describeActivity(view?.activity);
			onUpdate({
				content: [{ type: "text", text: body }],
				details: makeDetails(live, body),
			});
		},
	);

	return {
		content: [{ type: "text", text: output }],
		details: makeDetails(finalRecord, output),
	};
}

// --- Resume (F3) ---

async function runForegroundResume(
	_pi: ExtensionAPI,
	agent: AgentConfig,
	existingRecord: TaskRecord,
	followUpPrompt: string,
	_ctx: { cwd: string },
	signal: AbortSignal | undefined,
	onUpdate: ((partial: AgentToolResult<TaskDetails>) => void) | undefined,
	timeoutMs: number | undefined,
	resolvedModel: Model<any> | undefined,
): Promise<AgentToolResult<TaskDetails>> {
	const record: TaskRecord = {
		...existingRecord,
		description: existingRecord.description || makeDescription(followUpPrompt),
		state: "queued",
		startedAt: null,
		completedAt: null,
		background: false,
	};
	const childTools = deriveChildTools(agent.tools, false, existingRecord.childExtensions);
	const provider = resolvedModel?.provider ?? "unknown";
	state.widget?.ensureTimer();
	state.fleet?.ensureTimer();

	const { record: updatedRecord, output } = await state.runtime.runForeground(
		record,
		{
			cwd: existingRecord.cwd,
			sessionPath: existingRecord.sessionPath ?? "",
			provider,
			model: resolvedModel,
			tools: childTools,
			childExtensions: existingRecord.childExtensions,
			systemPrompt: null,
			task: followUpPrompt,
			timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
			signal,
			maxTurns: existingRecord.policy?.maxTurns,
			maxOutputTokens: existingRecord.policy?.maxOutputTokens,
			maxOutputTokensPerRequest: existingRecord.policy?.maxOutputTokensPerRequest,
			resultHeadBytes: existingRecord.policy?.resultHeadBytes,
			resultTailBytes: existingRecord.policy?.resultTailBytes,
			thinkingOverride: existingRecord.policy?.resolvedThinking,
		},
		(text, live) => {
			if (!onUpdate) return;
			const view = roster.get(live.id);
			const body = text || describeActivity(view?.activity) || `(resuming task ${live.id}...)`;
			onUpdate({
				content: [{ type: "text", text: body }],
				details: makeDetails(live, body),
			});
		},
	);

	return {
		content: [{ type: "text", text: output }],
		details: makeDetails(updatedRecord, output),
	};
}

// --- Background execution (F2) ---

interface BackgroundConfig {
	cwd: string;
	sessionPath: string;
	model?: Model<any>;
	tools?: string[];
	systemPrompt: string | null;
	task: string;
	timeoutMs: number;
	thinkingOverride?: ThinkingLevel;
}

async function runBackground(
	_pi: ExtensionAPI,
	agent: AgentConfig,
	record: TaskRecord,
	config: BackgroundConfig,
	_onUpdate: ((partial: AgentToolResult<TaskDetails>) => void) | undefined,
): Promise<AgentToolResult<TaskDetails>> {
	const provider = config.model?.provider ?? "unknown";
	const { record: queued } = state.runtime.startBackground(record, {
		cwd: config.cwd,
		sessionPath: config.sessionPath,
		provider,
		model: config.model,
		tools: config.tools,
		childExtensions: record.childExtensions,
		systemPrompt: config.systemPrompt,
		task: config.task,
		timeoutMs: config.timeoutMs,
		thinkingOverride: config.thinkingOverride ?? record.policy?.resolvedThinking,
		maxTurns: record.policy?.maxTurns,
		maxOutputTokens: record.policy?.maxOutputTokens,
		maxOutputTokensPerRequest: record.policy?.maxOutputTokensPerRequest,
		resultHeadBytes: record.policy?.resultHeadBytes,
		resultTailBytes: record.policy?.resultTailBytes,
	});

	state.widget?.ensureTimer();
	state.fleet?.ensureTimer();

	const runningMsg = [
		`Background task ${queued.id} started (agent: ${agent.name}).`,
		queued.state === "queued"
			? "Queued for admission; you will be notified automatically when it finishes."
			: "You will be notified automatically when it finishes.",
		"DO NOT sleep, poll for progress, or duplicate this task's work.",
		`Task ID: ${queued.id} (use with task_id to resume later).`,
	].join("\n");

	return {
		content: [{ type: "text", text: runningMsg }],
		details: makeDetails(queued, runningMsg),
	};
}

function makeDetails(record: TaskRecord, output: string): TaskDetails {
	return {
		taskId: record.id,
		agent: record.agent,
		agentSource: record.agentSource,
		state: record.state,
		background: record.background,
		output,
		error: record.error,
		sessionPath: record.sessionPath,
		usage: record.usage,
	};
}
