import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_PI_TASK_CONFIG,
	loadPiTaskConfig,
	providerConcurrencyLimit,
	resolveResumeTaskPolicy,
	resolveTaskPolicy,
	resolveThinkingLevel,
} from "../src/config.ts";

function writeTempConfig(json: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-config-"));
	const filePath = path.join(dir, "pi-task.json");
	fs.writeFileSync(filePath, json, "utf8");
	return filePath;
}

describe("config", () => {
	it("uses documented defaults when config file is absent", () => {
		const missing = path.join(os.tmpdir(), `pi-task-missing-${Date.now()}.json`);
		const loaded = loadPiTaskConfig(missing);
		assert.deepEqual(loaded.config, DEFAULT_PI_TASK_CONFIG);
		assert.equal(loaded.diagnostics.length, 0);
		assert.equal(loaded.config.maxConcurrent, 5);
		assert.equal(loaded.config.maxQueued, 8);
		assert.equal(loaded.config.defaultThinking, "inherit");
		assert.equal(loaded.config.defaultMaxTurns, 12);
		assert.equal(loaded.config.defaultMaxOutputTokens, 32768);
		assert.equal(loaded.config.maxOutputTokensPerRequest, 16384);
		assert.equal(loaded.config.resultHeadBytes, 16384);
		assert.equal(loaded.config.resultTailBytes, 8192);
	});

	it("loads a partial valid config over defaults", () => {
		const filePath = writeTempConfig(
			JSON.stringify({ maxConcurrent: 3, defaultMaxTurns: 6, providerConcurrency: { openai: 2 } }),
		);
		const loaded = loadPiTaskConfig(filePath);
		assert.equal(loaded.config.maxConcurrent, 3);
		assert.equal(loaded.config.defaultMaxTurns, 6);
		assert.equal(loaded.config.maxQueued, 8);
		assert.deepEqual(loaded.config.providerConcurrency, { openai: 2 });
		assert.equal(loaded.diagnostics.length, 0);
	});

	it("falls back to defaults on malformed JSON with one diagnostic", () => {
		const filePath = writeTempConfig("{ not json");
		const loaded = loadPiTaskConfig(filePath);
		assert.deepEqual(loaded.config, DEFAULT_PI_TASK_CONFIG);
		assert.equal(loaded.diagnostics.length, 1);
		assert.match(loaded.diagnostics[0]!.message, /malformed|invalid json|parse/i);
	});

	it("ignores invalid fields while retaining valid ones", () => {
		const filePath = writeTempConfig(
			JSON.stringify({
				maxConcurrent: 7,
				defaultMaxTurns: "nope",
				defaultMaxOutputTokens: -1,
				defaultThinking: "turbo",
				providerConcurrency: { anthropic: 1, bad: "x" },
			}),
		);
		const loaded = loadPiTaskConfig(filePath);
		assert.equal(loaded.config.maxConcurrent, 7);
		assert.equal(loaded.config.defaultMaxTurns, DEFAULT_PI_TASK_CONFIG.defaultMaxTurns);
		assert.equal(loaded.config.defaultMaxOutputTokens, DEFAULT_PI_TASK_CONFIG.defaultMaxOutputTokens);
		assert.equal(loaded.config.defaultThinking, "inherit");
		assert.deepEqual(loaded.config.providerConcurrency, { anthropic: 1 });
		assert.ok(loaded.diagnostics.some((d) => d.key === "defaultMaxTurns"));
		assert.ok(loaded.diagnostics.some((d) => d.key === "defaultMaxOutputTokens"));
		assert.ok(loaded.diagnostics.some((d) => d.key === "defaultThinking"));
		assert.ok(loaded.diagnostics.some((d) => d.key === "providerConcurrency.bad"));
	});

	it("treats provider limit zero as disabled", () => {
		const filePath = writeTempConfig(JSON.stringify({ providerConcurrency: { openai: 0 } }));
		const loaded = loadPiTaskConfig(filePath);
		assert.equal(providerConcurrencyLimit(loaded.config, "openai"), undefined);
		assert.equal(providerConcurrencyLimit(loaded.config, "anthropic"), undefined);
	});

	it("resolves provider limits from config", () => {
		const filePath = writeTempConfig(JSON.stringify({ providerConcurrency: { openai: 2 } }));
		const loaded = loadPiTaskConfig(filePath);
		assert.equal(providerConcurrencyLimit(loaded.config, "openai"), 2);
	});

	it("applies per-call overrides over file over defaults", () => {
		const filePath = writeTempConfig(
			JSON.stringify({ defaultMaxTurns: 9, defaultMaxOutputTokens: 1000, defaultThinking: "low" }),
		);
		const loaded = loadPiTaskConfig(filePath);
		const resolved = resolveTaskPolicy(loaded.config, {
			maxTurns: 3,
			maxOutputTokens: 500,
			thinking: "high",
		});
		assert.equal(resolved.maxTurns, 3);
		assert.equal(resolved.maxOutputTokens, 500);
		assert.equal(resolved.thinking, "high");
		assert.equal(resolved.maxOutputTokensPerRequest, 16384);
		assert.equal(resolved.resultHeadBytes, 16384);
		assert.equal(resolved.resultTailBytes, 8192);
	});

	it("treats zero overrides as disabled caps", () => {
		const resolved = resolveTaskPolicy(DEFAULT_PI_TASK_CONFIG, {
			maxTurns: 0,
			maxOutputTokens: 0,
		});
		assert.equal(resolved.maxTurns, 0);
		assert.equal(resolved.maxOutputTokens, 0);
	});

	it("inherits file thinking when override omitted", () => {
		const filePath = writeTempConfig(JSON.stringify({ defaultThinking: "medium" }));
		const loaded = loadPiTaskConfig(filePath);
		const resolved = resolveTaskPolicy(loaded.config, {});
		assert.equal(resolved.thinking, "medium");
		assert.equal(resolved.maxTurns, 12);
	});

	it("preserves persisted policy and applies explicit resume overrides", () => {
		const existing = resolveTaskPolicy(DEFAULT_PI_TASK_CONFIG, {
			maxTurns: 24,
			maxOutputTokens: 16000,
			thinking: "high",
		});
		const resolved = resolveResumeTaskPolicy(DEFAULT_PI_TASK_CONFIG, existing, { maxTurns: 16 });
		assert.equal(resolved.maxTurns, 16);
		assert.equal(resolved.maxOutputTokens, 16000);
		assert.equal(resolved.thinking, "high");
		assert.equal(resolved.maxOutputTokensPerRequest, existing.maxOutputTokensPerRequest);
	});

	it("resolves thinking with fork-forced-off precedence", () => {
		assert.equal(resolveThinkingLevel("high", "medium", true), "off");
		assert.equal(resolveThinkingLevel("high", "medium", false), "high");
		assert.equal(resolveThinkingLevel("inherit", "low", false), "low");
	});
});
