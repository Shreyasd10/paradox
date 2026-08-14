import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	defaultStageChatMouseScrollCapture,
	isEmbeddedIdeTerminal,
} from "../src/tui/overlay-terminal-modes.js";
import { lastAssistantText } from "../src/tui/stage-chat-last-assistant.js";

function assistant(text: string) {
	return {
		kind: "assistant",
		role: "assistant",
		message: { content: [{ type: "text", text }] },
	};
}

function user(text: string) {
	return {
		kind: "user",
		role: "user",
		message: { content: [{ type: "text", text }] },
	};
}

describe("stage chat copy mode defaults", () => {
	test("Cursor and VS Code are detected as embedded IDE terminals", () => {
		assert.equal(isEmbeddedIdeTerminal({ CURSOR_TRACE_ID: "1" }), true);
		assert.equal(isEmbeddedIdeTerminal({ VSCODE_PID: "1" }), true);
		assert.equal(isEmbeddedIdeTerminal({ TERM_PROGRAM: "vscode" }), true);
		assert.equal(isEmbeddedIdeTerminal({ TERM_PROGRAM: "iTerm.app" }), false);
	});

	test("mouse capture stays on so native select cannot freeze the overlay", () => {
		assert.equal(defaultStageChatMouseScrollCapture({ CURSOR_TRACE_ID: "1" }), true);
		assert.equal(defaultStageChatMouseScrollCapture({ TERM_PROGRAM: "iTerm.app" }), true);
	});
});

describe("lastAssistantText", () => {
	test("returns the newest non-empty assistant message", () => {
		assert.equal(
			lastAssistantText([user("hi"), assistant("first"), assistant("  second  "), user("ok")]),
			"second",
		);
	});

	test("skips empty assistant turns", () => {
		assert.equal(lastAssistantText([assistant(""), assistant("   "), assistant("kept")]), "kept");
		assert.equal(lastAssistantText([user("only user")]), undefined);
	});
});
