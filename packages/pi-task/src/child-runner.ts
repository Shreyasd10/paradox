/**
 * Native Pi session runner — typed event collection, provider error handling,
 * cancellation via AbortController, timeout, and output truncation.
 */

import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	DefaultPackageManager,
	DefaultResourceLoader,
	truncateHead,
	createAgentSession,
	createExtensionRuntime,
	SessionManager,
	SettingsManager,
	type ModelRuntime,
	type PackageManager,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "./config.ts";
import type { TaskEvent } from "./activity.ts";
import { resolveHostAgentDir } from "./host-paths.ts";
import type { ChildExtensionCapability, ChildRunOutput, LimitReason, UsageStats } from "./types.ts";
import { emptyUsage } from "./types.ts";
import { OutputBuffer } from "./output-buffer.ts";

// Project-wide subagent convention (mirrored from my-workflow/extensions/pi-task).
// Children are created with noExtensions (see index.ts runForeground/Background/Resume),
// so the ctx_* MCP tools are not loaded; lean-ctx is reached via the CLI binary, which
// is on PATH whenever lean-ctx is installed. Appending this to every child system
// prompt keeps subagents on the LeanCTX convention even though the MCP bridge is off.
const LEAN_CTX_PREFERENCE_PROMPT = `<!-- lean-ctx -->
You are running inside a LeanCTX-equipped environment. Prefer the \`lean-ctx\` CLI (compressed, session-cached) over native \`read\`/\`bash\`/\`grep\`/\`find\`/\`ls\`. Note: \`ctx_*\` MCP tools are NOT loaded in this child (\`--no-extensions\` is set), so reach lean-ctx via the CLI binary. See \`LEAN-CTX.md\` (open on demand) or run \`lean-ctx cheatsheet\` for the full mapping.
<!-- /lean-ctx -->
`;

export interface ChildRunOptions {
	cwd: string;
	sessionPath: string | null;
	model?: Model<any>;
	tools?: string[];
	systemPrompt: string | null;
	task: string;
	signal: AbortSignal | null;
	timeoutMs?: number;
	thinkingOverride?: ThinkingLevel;
	/** Shared immutable model/auth runtime (one per extension runtime). */
	modelRuntime?: ModelRuntime;
	/** 0 disables. */
	maxTurns?: number;
	/** 0 disables. */
	maxOutputTokens?: number;
	maxOutputTokensPerRequest?: number;
	resultHeadBytes?: number;
	resultTailBytes?: number;
	/** If true, use --no-session (ephemeral). */
	noSession?: boolean;
	/** If true, don't load extensions in the task session. */
	noExtensions?: boolean;
	/** If true, don't load skills in the task session. */
	noSkills?: boolean;
	/** Named extensions explicitly allowed in this task session. */
	childExtensions?: ChildExtensionCapability[];
	/** Live JSON-stream activity for the TUI. */
	onEvent?: (event: TaskEvent) => void;
	/** Test seam for createAgentSession. */
	createAgentSessionFn?: typeof createAgentSession;
	/** Test seam for task resource loading. */
	createTaskResourceLoaderFn?: typeof createTaskResourceLoader;
}


/** Convert one assistant message usage object into an explicit per-message delta. */
export function usageDeltaFromMessage(u: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number } | number;
} | null | undefined): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
} {
	if (!u) {
		return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	}
	const cost =
		typeof u.cost === "number" ? u.cost : (u.cost?.total ?? 0);
	return {
		input: u.input ?? 0,
		output: u.output ?? 0,
		cacheRead: u.cacheRead ?? 0,
		cacheWrite: u.cacheWrite ?? 0,
		cost,
	};
}


/** Exact append-system-prompt list used for every child (prompt bytes must stay stable). */
export function buildAppendSystemPrompts(systemPrompt: string | null | undefined): string[] {
	const prompt = systemPrompt?.trim();
	return [
		LEAN_CTX_PREFERENCE_PROMPT,
		...(prompt ? [prompt] : []),
	];
}


export const ADVISOR_PACKAGE_SOURCE = "npm:@juicesharp/rpiv-advisor";

/** Clamp provider maxTokens for a request under model/request/remaining caps. */
export function clampRequestMaxTokens(args: {
	existing?: number;
	modelMax?: number;
	perRequestCap: number;
	remaining: number;
	totalBudgetEnabled: boolean;
}): number | undefined {
	const candidates: number[] = [];
	if (typeof args.existing === "number" && args.existing > 0) candidates.push(args.existing);
	if (typeof args.modelMax === "number" && args.modelMax > 0) candidates.push(args.modelMax);
	if (args.perRequestCap > 0) candidates.push(args.perRequestCap);
	if (args.totalBudgetEnabled) candidates.push(Math.max(0, args.remaining));
	if (candidates.length === 0) return args.existing;
	return Math.min(...candidates);
}

export interface TaskResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	systemPrompt: string | null | undefined;
	childExtensions?: ChildExtensionCapability[];
	packageManager?: Pick<PackageManager, "resolveExtensionSources">;
	createDefaultResourceLoaderFn?: (
		options: ConstructorParameters<typeof DefaultResourceLoader>[0],
	) => ResourceLoader;
}

function createIsolatedResourceLoader(append: string[]): ResourceLoader {
	const runtime = createExtensionRuntime();
	const emptyDiagnostics: never[] = [];
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime }),
		getSkills: () => ({ skills: [], diagnostics: emptyDiagnostics }),
		getPrompts: () => ({ prompts: [], diagnostics: emptyDiagnostics }),
		getThemes: () => ({ themes: [], diagnostics: emptyDiagnostics }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => append,
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

export async function createTaskResourceLoader(options: TaskResourceLoaderOptions): Promise<ResourceLoader> {
	const append = buildAppendSystemPrompts(options.systemPrompt);
	if (!options.childExtensions?.includes("advisor")) {
		return createIsolatedResourceLoader(append);
	}

	const packageManager = options.packageManager ?? new DefaultPackageManager({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager: options.settingsManager,
	});
	const resolved = await packageManager.resolveExtensionSources([ADVISOR_PACKAGE_SOURCE]);
	const advisorPaths = resolved.extensions
		.filter((resource) => resource.enabled)
		.map((resource) => resource.path);
	if (advisorPaths.length === 0) {
		throw new Error("Advisor package did not expose an enabled Pi extension.");
	}

	const loaderSettings = SettingsManager.inMemory(
		{ packages: [] },
		{ projectTrusted: false },
	);
	const createLoader = options.createDefaultResourceLoaderFn
		?? ((loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0]) => new DefaultResourceLoader(loaderOptions));
	const loader = createLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager: loaderSettings,
		additionalExtensionPaths: advisorPaths,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "",
		appendSystemPrompt: [],
		appendSystemPromptOverride: () => append,
	});
	await loader.reload();
	const extensionErrors = loader.getExtensions().errors;
	if (extensionErrors.length > 0) {
		const details = extensionErrors.map(({ path, error }) => `${path}: ${error}`).join("; ");
		throw new Error(`Failed to load Advisor extension: ${details}`);
	}
	return loader;
}


function getText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return typeof part === "object" && part !== null && (part as { type?: string }).type === "text";
		})
		.map((part) => part.text)
		.join("");
}

function getLastAssistantText(messages: readonly any[], startIndex: number): string {
	for (let i = messages.length - 1; i >= startIndex; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const text = getText(message.content).trim();
		if (text) return text;
	}
	return "";
}

function getFinalTurnError(messages: readonly any[], startIndex: number): string | undefined {
	for (let i = messages.length - 1; i >= startIndex; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		if (message.stopReason === "error") {
			return message.errorMessage?.trim() || "provider error with no output";
		}
		if (message.stopReason === "length" && !getText(message.content).trim()) {
			return "run hit the output token limit before producing any text";
		}
		return undefined;
	}
	return undefined;
}

function truncateOutput(output: string): { content: string; truncated: boolean } {
	const result = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (result.truncated) {
		return {
			content: `${result.content}\n\n[Output truncated: ${result.outputLines} of ${result.totalLines} lines. Full output in task session/artifact files.]`,
			truncated: true,
		};
	}
	return { content: output, truncated: false };
}

/**
 * Run a child task in a native Pi AgentSession.
 *
 * Keeping the session in this process preserves Pi's model resolution,
 * provider retry handling, typed events, and final error metadata.
 */
export async function runChild(opts: ChildRunOptions): Promise<ChildRunOutput> {
	const agentDir = resolveHostAgentDir();
	const settingsManager = SettingsManager.create(opts.cwd, agentDir);
	const createResourceLoader = opts.createTaskResourceLoaderFn ?? createTaskResourceLoader;
	const resourceLoader = await createResourceLoader({
		cwd: opts.cwd,
		agentDir,
		settingsManager,
		systemPrompt: opts.systemPrompt,
		childExtensions: opts.childExtensions,
	});
	const createSession = opts.createAgentSessionFn ?? createAgentSession;

	const sessionManager =
		opts.sessionPath && !opts.noSession
			? SessionManager.open(opts.sessionPath, path.dirname(opts.sessionPath), opts.cwd)
			: SessionManager.inMemory(opts.cwd);
	let unsubscribe = () => {};
	let cleanup = () => {};
	let disposeSession = () => {};
	try {
		const { session } = await createSession({
			cwd: opts.cwd,
			agentDir,
			settingsManager,
			model: opts.model,
			thinkingLevel: opts.thinkingOverride,
			tools: opts.tools,
			resourceLoader,
			sessionManager,
			modelRuntime: opts.modelRuntime,
		});
		disposeSession = () => session.dispose();
		await session.bindExtensions({});

	const usage: UsageStats = emptyUsage();
	const startIndex = session.messages.length;
	let timedOut = false;
	let wasAborted = false;
	let settled = false;
	let timeoutTimer: NodeJS.Timeout | undefined;
	const outputBuffer = new OutputBuffer({
		headBytes: opts.resultHeadBytes ?? 16384,
		tailBytes: opts.resultTailBytes ?? 8192,
	});
	let sawText = false;
	let onAbort = () => {};
	let limitReason: LimitReason | null = null;
	let completedTurns = 0;
	const maxTurns = opts.maxTurns ?? 0;
	const totalBudget = opts.maxOutputTokens ?? 0;
	const perRequestCap = opts.maxOutputTokensPerRequest ?? 0;
	let remainingOutput = totalBudget > 0 ? totalBudget : Number.POSITIVE_INFINITY;
	const totalBudgetEnabled = totalBudget > 0;

	const agent = (session as { agent?: { streamFn?: any } }).agent;
	const baseStreamFn = agent?.streamFn;
	if (agent && typeof baseStreamFn === "function") {
		agent.streamFn = (model: any, context: any, options: any = {}) => {
			if (totalBudgetEnabled && remainingOutput <= 0) {
				limitReason = "output";
				void session.abort();
				return baseStreamFn(model, context, options);
			}
			const maxTokens = clampRequestMaxTokens({
				existing: options?.maxTokens,
				modelMax: model?.maxTokens,
				perRequestCap,
				remaining: Number.isFinite(remainingOutput) ? remainingOutput : Number.MAX_SAFE_INTEGER,
				totalBudgetEnabled,
			});
			return baseStreamFn(model, context, { ...options, ...(maxTokens !== undefined ? { maxTokens } : {}) });
		};
	}

	cleanup = () => {
		if (timeoutTimer) clearTimeout(timeoutTimer);
		if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
	};
	const finish = (result: ChildRunOutput): ChildRunOutput => {
		if (!settled) {
			settled = true;
			cleanup();
		}
		return result;
	};
	onAbort = () => {
		if (settled) return;
		wasAborted = true;
		session.abort();
	};

	unsubscribe = session.subscribe((event: any) => {
		if (event.type === "turn_start") opts.onEvent?.({ type: "turn_start" });
		if (event.type === "turn_end") {
			completedTurns++;
			if (maxTurns > 0 && completedTurns >= maxTurns && !limitReason) {
				limitReason = "turns";
				void session.abort();
			}
		}
		if (event.type === "message_start" && event.message?.role === "assistant") {
			outputBuffer.reset();
			sawText = false;
		}
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta ?? "";
			if (delta) {
				sawText = true;
				outputBuffer.append(delta);
				opts.onEvent?.({ type: "text_delta", delta });
			}
		}
		if (event.type === "tool_execution_start") {
			opts.onEvent?.({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName });
		}
		if (event.type === "tool_execution_end") {
			opts.onEvent?.({ type: "tool_end", toolCallId: event.toolCallId, toolName: event.toolName });
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			usage.turns++;
			const delta = usageDeltaFromMessage(event.message.usage);
			usage.input += delta.input;
			usage.output += delta.output;
			usage.cacheRead += delta.cacheRead;
			usage.cacheWrite += delta.cacheWrite;
			usage.cost += delta.cost;
			if (totalBudgetEnabled) {
				remainingOutput = Math.max(0, remainingOutput - delta.output);
				if (remainingOutput <= 0 && !limitReason) limitReason = "output";
			}
			if (event.message.stopReason === "length" && getText(event.message.content).trim() && !limitReason) {
				limitReason = "output";
			}
			opts.onEvent?.({ type: "message_end", role: "assistant", usage: delta });
		}
	});

	if (opts.signal) {
		if (opts.signal.aborted) onAbort();
		else opts.signal.addEventListener("abort", onAbort, { once: true });
	}
	if (opts.timeoutMs && opts.timeoutMs > 0) {
		timeoutTimer = setTimeout(() => {
			if (settled) return;
			timedOut = true;
			session.abort();
		}, opts.timeoutMs);
		timeoutTimer.unref?.();
	}

	try {
		await session.prompt(opts.task);
		const failure = getFinalTurnError(session.messages, startIndex);
		if (!sawText) {
			const full = getLastAssistantText(session.messages, startIndex);
			if (full) outputBuffer.append(full);
		}
		const bounded = outputBuffer.finalize(opts.sessionPath);
		const responseText = bounded.content.trim();
		const budgetLimited = Boolean(limitReason) && Boolean(responseText) && !timedOut;
		const interrupted = wasAborted && !budgetLimited;
		const fallback = failure || "(no output)";
		const content = responseText || fallback;
		const truncated = bounded.truncated;
		const exitCode = budgetLimited ? 0 : failure || interrupted || timedOut ? 1 : 0;
		let output = content;
		if (timedOut && !responseText) {
			output = `${content}\nTimed out before producing assistant output.`;
		} else if (limitReason === "turns") {
			output = `${content}\n\n[Stopped: reached max_turns=${maxTurns}. Resume with task_id and a higher max_turns or max_turns: 0.]`;
		} else if (limitReason === "output") {
			output = `${content}\n\n[Stopped: reached output token budget. Resume with task_id and a higher max_output_tokens or max_output_tokens: 0.]`;
		}
		return finish({
			exitCode,
			output,
			stderr: "",
			usage,
			model: opts.model?.id ?? null,
			interrupted,
			timedOut,
			truncated,
			limitReason,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const budgetLimited = Boolean(limitReason) && !timedOut;
		return finish({
			exitCode: budgetLimited ? 0 : 1,
			output: timedOut ? `${message}\nTimed out before producing assistant output.` : message,
			stderr: "",
			usage,
			model: opts.model?.id ?? null,
			interrupted: wasAborted && !budgetLimited,
			timedOut,
			truncated: false,
			limitReason,
		});
		}
	} finally {
		unsubscribe();
		cleanup();
		disposeSession();
	}
}

/**
 * Derive the child tool allowlist from the agent config.
 * Denies `task` and todo management tools by default (R7).
 */
export function deriveChildTools(
	agentTools: string[] | undefined,
	allowRecursion: boolean,
	childExtensions?: ChildExtensionCapability[],
): string[] | undefined {
	if (!agentTools || agentTools.length === 0) return undefined;
	const tools = [...agentTools];
	// Always deny `task` unless explicitly allowed
	if (!allowRecursion) {
		const taskIdx = tools.indexOf("task");
		if (taskIdx !== -1) tools.splice(taskIdx, 1);
		const subagentIdx = tools.indexOf("subagent");
		if (subagentIdx !== -1) tools.splice(subagentIdx, 1);
	}
	// Deny todo management by default
	const todoIdx = tools.indexOf("todowrite");
	if (todoIdx !== -1) tools.splice(todoIdx, 1);
	if (childExtensions?.includes("advisor") && !tools.includes("advisor")) {
		tools.push("advisor");
	}
	return tools.length > 0 ? tools : undefined;
}
