import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for fork-context sanitization logic.
 * The sanitization functions are internal to fork-context.ts, so we test
 * the public createForkSession function with a mock session manager.
 */

describe("fork-context", () => {
	describe("createForkSession — mock session manager", () => {
		it("throws when parent session file is missing", async () => {
			const { createForkSession } = await import("../src/fork-context.ts");
			const mockSm = {
				getSessionFile: () => undefined as string | undefined,
				getLeafId: () => "leaf-1" as string | null,
			};
			assert.throws(() => createForkSession(mockSm as never), /persisted parent session/);
		});

		it("throws when leaf ID is null", async () => {
			const { createForkSession } = await import("../src/fork-context.ts");
			const mockSm = {
				getSessionFile: () => "/tmp/fake-session.jsonl" as string | undefined,
				getLeafId: () => null as string | null,
			};
			assert.throws(() => createForkSession(mockSm as never), /current leaf/);
		});

		it("throws when parent session file does not exist on disk", async () => {
			const { createForkSession } = await import("../src/fork-context.ts");
			const mockSm = {
				getSessionFile: () => "/tmp/nonexistent-session-file.jsonl" as string | undefined,
				getLeafId: () => "leaf-1" as string | null,
			};
			assert.throws(() => createForkSession(mockSm as never), /does not exist/);
		});
	});

	describe("createForkSession — with real temp session file", () => {
		it("creates forked session and sanitizes parent-only entries", async () => {
			const fs = await import("node:fs");
			const os = await import("node:os");
			const path = await import("node:path");
			const { createForkSession } = await import("../src/fork-context.ts");

			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-test-"));
			const parentFile = path.join(tmpDir, "parent.jsonl");

			// Create a parent session with various entry types
			const entries = [
				JSON.stringify({ type: "session", id: "root", parentId: null, timestamp: new Date().toISOString() }),
				JSON.stringify({ type: "message", id: "m1", parentId: "root", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
				JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "hi" }], provider: "anthropic", api: "anthropic-messages" } }),
				JSON.stringify({ type: "custom", id: "c1", parentId: "m2", timestamp: new Date().toISOString(), customType: "subagent_result", message: { role: "custom" } }),
			];
			fs.writeFileSync(parentFile, entries.join("\n") + "\n");

			const mockSm = {
				getSessionFile: () => parentFile,
				getLeafId: () => "m2",
				openSession: () => ({
					createBranchedSession: () => {
						// Simulate creating a fork file
						const forkFile = path.join(tmpDir, "fork.jsonl");
						// Copy the parent entries as the "fork"
						fs.writeFileSync(forkFile, entries.join("\n") + "\n");
						return forkFile;
					},
					getHeader: () => JSON.parse(entries[0]),
					getEntries: () => entries.slice(1).map((e) => JSON.parse(e)),
				}),
			};

			const result = createForkSession(mockSm as never);
			assert.ok(result.sessionFile);
			assert.ok(fs.existsSync(result.sessionFile));

			// Verify parent-only entries (custom subagent_result) are removed
			const forkContent = fs.readFileSync(result.sessionFile, "utf-8");
			const forkEntries = forkContent.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
			const hasSubagentEntry = forkEntries.some((e: any) => e.type === "custom" && e.customType === "subagent_result");
			assert.equal(hasSubagentEntry, false, "subagent_result custom entry should be removed");

			// Verify normal messages are kept
			const hasUserMessage = forkEntries.some((e: any) => e.type === "message" && e.message?.role === "user");
			assert.ok(hasUserMessage, "user message should be preserved");

			// Clean up
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("sanitizes unsafe Anthropic thinking blocks", async () => {
			const fs = await import("node:fs");
			const os = await import("node:os");
			const path = await import("node:path");
			const { createForkSession } = await import("../src/fork-context.ts");

			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-thinking-"));
			const parentFile = path.join(tmpDir, "parent.jsonl");

			const entries = [
				JSON.stringify({ type: "session", id: "root", parentId: null }),
				JSON.stringify({
					type: "message",
					id: "m1",
					parentId: "root",
					message: {
						role: "assistant",
						content: [
							{ type: "text", text: "response" },
							{ type: "thinking", thinking: "secret", thinkingSignature: "abc123" },
						],
						provider: "anthropic",
						api: "anthropic-messages",
					},
				}),
			];
			fs.writeFileSync(parentFile, entries.join("\n") + "\n");

			const mockSm = {
				getSessionFile: () => parentFile,
				getLeafId: () => "m1",
				openSession: () => ({
					createBranchedSession: () => {
						const forkFile = path.join(tmpDir, "fork.jsonl");
						fs.writeFileSync(forkFile, entries.join("\n") + "\n");
						return forkFile;
					},
					getHeader: () => JSON.parse(entries[0]),
					getEntries: () => entries.slice(1).map((e) => JSON.parse(e)),
				}),
			};

			const result = createForkSession(mockSm as never);
			assert.ok(result.thinkingOverride, "should set thinkingOverride to 'off'");

			const forkContent = fs.readFileSync(result.sessionFile, "utf-8");
			const forkEntries = forkContent.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

			// The thinking block should be removed
			for (const entry of forkEntries) {
				if (entry.type === "message" && entry.message?.role === "assistant") {
					const hasThinking = entry.message.content.some((b: any) => b.type === "thinking");
					assert.equal(hasThinking, false, "thinking block with signature should be removed");
				}
			}

			// A thinking_level_change entry should be appended
			const hasThinkingOff = forkEntries.some((e: any) => e.type === "thinking_level_change" && e.thinkingLevel === "off");
			assert.ok(hasThinkingOff, "thinking_level_change:off entry should be appended");

			fs.rmSync(tmpDir, { recursive: true, force: true });
		});
	});
});
