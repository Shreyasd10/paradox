import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { resolveHostAgentDir } from "../src/host-paths.ts";

describe("resolveHostAgentDir", () => {
	it("defaults to the stock Pi agent root independently of the host SDK", () => {
		assert.equal(resolveHostAgentDir({}, "/home/tester"), path.join("/home/tester", ".pi", "agent"));
	});

	it("prefers the Pi override and accepts Atomic's override as a compatibility fallback", () => {
		assert.equal(
			resolveHostAgentDir(
				{ PI_CODING_AGENT_DIR: "/pi-agent", ATOMIC_CODING_AGENT_DIR: "/atomic-agent" },
				"/home/tester",
			),
			"/pi-agent",
		);
		assert.equal(
			resolveHostAgentDir({ ATOMIC_CODING_AGENT_DIR: "/atomic-agent" }, "/home/tester"),
			"/atomic-agent",
		);
	});

	it("expands tilde overrides", () => {
		assert.equal(
			resolveHostAgentDir({ PI_CODING_AGENT_DIR: "~/custom-agent" }, "/home/tester"),
			path.join("/home/tester", "custom-agent"),
		);
	});
});
