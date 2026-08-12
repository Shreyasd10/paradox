/**
 * Global pi-task runtime policy loaded from ~/.pi/agent/pi-task.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveHostAgentDir } from "./host-paths.ts";

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export type ThinkingPolicy = "inherit" | ThinkingLevel;

export interface PiTaskConfig {
	maxConcurrent: number;
	maxQueued: number;
	providerConcurrency: Record<string, number>;
	defaultThinking: ThinkingPolicy;
	defaultMaxTurns: number;
	defaultMaxOutputTokens: number;
	maxOutputTokensPerRequest: number;
	resultHeadBytes: number;
	resultTailBytes: number;
}

export interface TaskPolicyOverrides {
	maxTurns?: number;
	maxOutputTokens?: number;
	thinking?: ThinkingPolicy;
}

export interface ResolvedTaskPolicy {
	maxTurns: number;
	maxOutputTokens: number;
	maxOutputTokensPerRequest: number;
	thinking: ThinkingPolicy;
	resultHeadBytes: number;
	resultTailBytes: number;
}

export interface ConfigDiagnostic {
	key?: string;
	message: string;
}

export interface LoadConfigResult {
	config: PiTaskConfig;
	diagnostics: ConfigDiagnostic[];
}

export const DEFAULT_PI_TASK_CONFIG: PiTaskConfig = {
	maxConcurrent: 5,
	maxQueued: 8,
	providerConcurrency: {},
	defaultThinking: "inherit",
	defaultMaxTurns: 12,
	defaultMaxOutputTokens: 32768,
	maxOutputTokensPerRequest: 16384,
	resultHeadBytes: 16384,
	resultTailBytes: 8192,
};

const THINKING_VALUES = new Set<ThinkingPolicy>([
	"inherit",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function isNonNegativeInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function cloneDefaults(): PiTaskConfig {
	return {
		...DEFAULT_PI_TASK_CONFIG,
		providerConcurrency: { ...DEFAULT_PI_TASK_CONFIG.providerConcurrency },
	};
}

/** Default config path: ~/.pi/agent/pi-task.json */
export function defaultPiTaskConfigPath(): string {
	return path.join(resolveHostAgentDir(), "pi-task.json");
}

/**
 * Load and validate pi-task config from disk.
 * Missing file → defaults, no diagnostics. Malformed JSON → defaults + one diagnostic.
 * Invalid fields are ignored; valid siblings are kept.
 */
export function loadPiTaskConfig(configPath: string = defaultPiTaskConfigPath()): LoadConfigResult {
	const diagnostics: ConfigDiagnostic[] = [];
	if (!fs.existsSync(configPath)) {
		return { config: cloneDefaults(), diagnostics };
	}

	let raw: string;
	try {
		raw = fs.readFileSync(configPath, "utf8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			config: cloneDefaults(),
			diagnostics: [{ message: `Failed to read pi-task config: ${message}` }],
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			config: cloneDefaults(),
			diagnostics: [{ message: `Malformed JSON in pi-task config: ${configPath}` }],
		};
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			config: cloneDefaults(),
			diagnostics: [{ message: `pi-task config must be a JSON object: ${configPath}` }],
		};
	}

	const obj = parsed as Record<string, unknown>;
	const config = cloneDefaults();

	if ("maxConcurrent" in obj) {
		if (isPositiveInt(obj.maxConcurrent)) config.maxConcurrent = obj.maxConcurrent;
		else diagnostics.push({ key: "maxConcurrent", message: "maxConcurrent must be a positive integer" });
	}
	if ("maxQueued" in obj) {
		if (isNonNegativeInt(obj.maxQueued)) config.maxQueued = obj.maxQueued;
		else diagnostics.push({ key: "maxQueued", message: "maxQueued must be a non-negative integer" });
	}
	if ("defaultThinking" in obj) {
		if (typeof obj.defaultThinking === "string" && THINKING_VALUES.has(obj.defaultThinking as ThinkingPolicy)) {
			config.defaultThinking = obj.defaultThinking as ThinkingPolicy;
		} else {
			diagnostics.push({ key: "defaultThinking", message: "defaultThinking must be inherit|off|minimal|low|medium|high|xhigh|max" });
		}
	}
	if ("defaultMaxTurns" in obj) {
		if (isNonNegativeInt(obj.defaultMaxTurns)) config.defaultMaxTurns = obj.defaultMaxTurns;
		else diagnostics.push({ key: "defaultMaxTurns", message: "defaultMaxTurns must be a non-negative integer" });
	}
	if ("defaultMaxOutputTokens" in obj) {
		if (isNonNegativeInt(obj.defaultMaxOutputTokens)) config.defaultMaxOutputTokens = obj.defaultMaxOutputTokens;
		else diagnostics.push({ key: "defaultMaxOutputTokens", message: "defaultMaxOutputTokens must be a non-negative integer" });
	}
	if ("maxOutputTokensPerRequest" in obj) {
		if (isPositiveInt(obj.maxOutputTokensPerRequest)) {
			config.maxOutputTokensPerRequest = obj.maxOutputTokensPerRequest;
		} else {
			diagnostics.push({
				key: "maxOutputTokensPerRequest",
				message: "maxOutputTokensPerRequest must be a positive integer",
			});
		}
	}
	if ("resultHeadBytes" in obj) {
		if (isNonNegativeInt(obj.resultHeadBytes)) config.resultHeadBytes = obj.resultHeadBytes;
		else diagnostics.push({ key: "resultHeadBytes", message: "resultHeadBytes must be a non-negative integer" });
	}
	if ("resultTailBytes" in obj) {
		if (isNonNegativeInt(obj.resultTailBytes)) config.resultTailBytes = obj.resultTailBytes;
		else diagnostics.push({ key: "resultTailBytes", message: "resultTailBytes must be a non-negative integer" });
	}
	if ("providerConcurrency" in obj) {
		if (obj.providerConcurrency === null || typeof obj.providerConcurrency !== "object" || Array.isArray(obj.providerConcurrency)) {
			diagnostics.push({ key: "providerConcurrency", message: "providerConcurrency must be an object of provider → non-negative integer" });
		} else {
			const providers: Record<string, number> = {};
			for (const [key, value] of Object.entries(obj.providerConcurrency as Record<string, unknown>)) {
				if (isNonNegativeInt(value)) providers[key] = value;
				else diagnostics.push({ key: `providerConcurrency.${key}`, message: `providerConcurrency.${key} must be a non-negative integer` });
			}
			config.providerConcurrency = providers;
		}
	}

	return { config, diagnostics };
}

/** Provider cap, or undefined when absent/zero (disabled → use global only). */
export function providerConcurrencyLimit(config: PiTaskConfig, provider: string): number | undefined {
	const limit = config.providerConcurrency[provider];
	if (limit === undefined || limit === 0) return undefined;
	return limit;
}

/** Merge per-call override → file config → built-in defaults. Zero disables that cap. */
export function resolveTaskPolicy(
	config: PiTaskConfig,
	overrides: TaskPolicyOverrides = {},
): ResolvedTaskPolicy {
	return {
		maxTurns: overrides.maxTurns ?? config.defaultMaxTurns,
		maxOutputTokens: overrides.maxOutputTokens ?? config.defaultMaxOutputTokens,
		maxOutputTokensPerRequest: config.maxOutputTokensPerRequest,
		thinking: overrides.thinking ?? config.defaultThinking,
		resultHeadBytes: config.resultHeadBytes,
		resultTailBytes: config.resultTailBytes,
	};
}

/**
 * Resolve thinking for a child run.
 * Precedence: forced off (fork safety) → task/config policy → parent inherit.
 */
export function resolveThinkingLevel(
	policy: ThinkingPolicy,
	parentThinking: ThinkingLevel,
	forcedOff = false,
): ThinkingLevel {
	if (forcedOff) return "off";
	if (policy === "inherit") return parentThinking;
	return policy;
}
