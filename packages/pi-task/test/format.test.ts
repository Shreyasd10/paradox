import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	describeActivity,
	formatFleetElapsed,
	formatFleetTokens,
	formatGrokElapsedBracket,
	formatMs,
	formatTokens,
	formatTurns,
	totalTokens,
} from "../src/ui/format.ts";
import { emptyActivity, emptyUsage } from "../src/types.ts";

describe("ui/format", () => {
	it("formats tokens compactly", () => {
		assert.equal(formatTokens(500), "500 token");
		assert.equal(formatTokens(12_400), "12.4k token");
		assert.equal(formatTokens(1_200_000), "1.2M token");
	});

	it("formats duration like Grok format_duration", () => {
		assert.equal(formatMs(1500), "1.5s");
		assert.equal(formatMs(9500), "9.5s");
		assert.equal(formatMs(11_400), "11s");
		assert.equal(formatMs(65_000), "1m5s");
		assert.equal(formatFleetElapsed(11_400), "11s");
		assert.equal(formatFleetTokens(13_100), "↓ 13.1k tokens");
		assert.equal(formatTurns(5), "↻5");
		assert.equal(formatGrokElapsedBracket(1700), "[1.7s]");
		assert.equal(formatGrokElapsedBracket(10_000, true), "[✓]");
	});

	it("describes tool activity in Grok Running: form", () => {
		const a = emptyActivity();
		a.activeTools.set("1", "read");
		a.activeTools.set("2", "grep");
		const text = describeActivity(a);
		assert.ok(text.startsWith("Running:"));
		assert.ok(text.includes("Read") || text.includes("Search"));
		assert.equal(describeActivity(undefined), "Thinking");
		assert.equal(describeActivity(emptyActivity()), "Thinking");
	});

	it("sums usage tokens", () => {
		const u = emptyUsage();
		u.input = 10;
		u.output = 5;
		u.cacheRead = 2;
		assert.equal(totalTokens(u), 17);
	});
});
