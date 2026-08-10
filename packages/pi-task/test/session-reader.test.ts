import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readSessionMessages } from "../src/session-reader.ts";

describe("session-reader", () => {
	let tmp = "";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-session-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("returns empty for missing path", () => {
		assert.deepEqual(readSessionMessages(null), []);
		assert.deepEqual(readSessionMessages("/no/such/file.jsonl"), []);
	});

	it("parses user and assistant messages from session.jsonl", () => {
		const file = path.join(tmp, "session.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "x" }),
			JSON.stringify({
				type: "message",
				message: { role: "user", content: [{ type: "text", text: "Task: find auth" }] },
			}),
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Looking…" },
						{ type: "toolCall", name: "grep" },
					],
				},
			}),
			JSON.stringify({
				type: "message",
				message: { role: "toolResult", content: [{ type: "text", text: "match" }] },
			}),
		];
		fs.writeFileSync(file, lines.join("\n"));
		const msgs = readSessionMessages(file);
		assert.equal(msgs.length, 3);
		assert.equal(msgs[0].role, "user");
		assert.ok(msgs[0].role === "user" && msgs[0].text.includes("find auth"));
		assert.equal(msgs[1].role, "assistant");
		assert.ok(msgs[1].role === "assistant" && msgs[1].tools.includes("grep"));
		assert.equal(msgs[2].role, "toolResult");
	});
});
