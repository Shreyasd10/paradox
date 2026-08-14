import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { moveOption } from "../src/tui/option-navigation.js";

describe("workflow form option navigation", () => {
	test("moves through boolean options before leaving either edge", () => {
		assert.deepEqual(moveOption(["true", "false"], "false", -1), { value: "true", focusDelta: 0 });
		assert.deepEqual(moveOption(["true", "false"], "true", -1), { value: "true", focusDelta: -1 });
		assert.deepEqual(moveOption(["true", "false"], "true", +1), { value: "false", focusDelta: 0 });
		assert.deepEqual(moveOption(["true", "false"], "false", +1), { value: "false", focusDelta: 1 });
	});

	test("allows iteration_context to navigate upward and then leave the field", () => {
		assert.deepEqual(moveOption(["fresh", "fork"], "fork", -1), { value: "fresh", focusDelta: 0 });
		assert.deepEqual(moveOption(["fresh", "fork"], "fresh", -1), { value: "fresh", focusDelta: -1 });
	});
});
