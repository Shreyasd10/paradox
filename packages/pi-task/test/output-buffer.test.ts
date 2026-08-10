import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OutputBuffer, trimToUtf8End, trimToUtf8Start } from "../src/output-buffer.ts";

describe("output-buffer", () => {
	it("returns short output unchanged", () => {
		const buf = new OutputBuffer({ headBytes: 16, tailBytes: 8 });
		buf.append("hello world");
		const result = buf.finalize("/tmp/session.jsonl");
		assert.equal(result.truncated, false);
		assert.equal(result.content, "hello world");
		assert.equal(result.omittedBytes, 0);
	});

	it("keeps 16KB head and 8KB tail semantics on large output", () => {
		const headBytes = 16;
		const tailBytes = 8;
		const buf = new OutputBuffer({ headBytes, tailBytes });
		const head = "H".repeat(headBytes);
		const mid = "M".repeat(40);
		const tail = "T".repeat(tailBytes);
		buf.append(head + mid + tail);
		const result = buf.finalize("/tmp/child/session.jsonl");
		assert.equal(result.truncated, true);
		assert.ok(result.content.startsWith(head));
		assert.ok(result.content.endsWith(tail));
		assert.ok(result.content.includes("omitted 40 bytes"));
		assert.ok(result.content.includes("/tmp/child/session.jsonl"));
		assert.equal(result.omittedBytes, 40);
	});

	it("never splits multibyte UTF-8 code points at boundaries", () => {
		const euro = "€"; // 3 bytes
		assert.equal(Buffer.byteLength(euro, "utf8"), 3);
		const buf = new OutputBuffer({ headBytes: 4, tailBytes: 4 });
		// 2 euros = 6 bytes into head(4) → trim head to valid; rest to tail
		buf.append(euro.repeat(5));
		const result = buf.finalize();
		assert.doesNotThrow(() => Buffer.from(result.content, "utf8"));
		// No replacement character from split sequences
		assert.ok(!result.content.includes("\uFFFD"));
	});

	it("stays bounded while streaming huge input", () => {
		const buf = new OutputBuffer({ headBytes: 32, tailBytes: 16 });
		for (let i = 0; i < 10_000; i++) buf.append("x".repeat(100));
		const result = buf.finalize();
		assert.equal(result.truncated, true);
		assert.ok(result.content.length < 200);
		assert.ok(result.omittedBytes > 0);
	});

	it("trim helpers drop incomplete sequences", () => {
		const euro = Buffer.from("€", "utf8");
		const head = Buffer.concat([Buffer.from("ab"), euro.subarray(0, 2)]);
		const trimmedHead = trimToUtf8End(head, head.length);
		assert.equal(trimmedHead.toString("utf8"), "ab");
		const tail = Buffer.concat([euro.subarray(1), Buffer.from("yz")]);
		const trimmedTail = trimToUtf8Start(tail, tail.length);
		assert.equal(trimmedTail.toString("utf8"), "yz");
	});
});
