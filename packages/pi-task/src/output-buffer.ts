/**
 * UTF-8 byte-aware streaming head/tail accumulator for parent-visible output.
 */

export interface OutputBufferOptions {
	headBytes: number;
	tailBytes: number;
}

export interface OutputBufferResult {
	content: string;
	truncated: boolean;
	totalBytes: number;
	omittedBytes: number;
	headBytes: number;
	tailBytes: number;
}

export class OutputBuffer {
	private readonly headBytes: number;
	private readonly tailBytes: number;
	private readonly headChunks: Buffer[] = [];
	private headSize = 0;
	private readonly tailChunks: Buffer[] = [];
	private tailSize = 0;
	private totalBytes = 0;
	private truncated = false;

	constructor(opts: OutputBufferOptions) {
		this.headBytes = Math.max(0, opts.headBytes);
		this.tailBytes = Math.max(0, opts.tailBytes);
	}

	reset(): void {
		this.headChunks.length = 0;
		this.headSize = 0;
		this.tailChunks.length = 0;
		this.tailSize = 0;
		this.totalBytes = 0;
		this.truncated = false;
	}

	append(text: string): void {
		if (!text) return;
		const chunk = Buffer.from(text, "utf8");
		this.totalBytes += chunk.length;

		if (this.headSize < this.headBytes) {
			const need = this.headBytes - this.headSize;
			if (chunk.length <= need) {
				this.headChunks.push(chunk);
				this.headSize += chunk.length;
				return;
			}
			this.headChunks.push(chunk.subarray(0, need));
			this.headSize = this.headBytes;
			const rest = chunk.subarray(need);
			if (rest.length > 0) this.pushTail(rest);
			this.truncated = true;
			return;
		}

		this.truncated = true;
		this.pushTail(chunk);
	}

	private pushTail(chunk: Buffer): void {
		if (this.tailBytes <= 0) return;
		this.tailChunks.push(chunk);
		this.tailSize += chunk.length;
		while (this.tailSize > this.tailBytes && this.tailChunks.length > 0) {
			const overflow = this.tailSize - this.tailBytes;
			const first = this.tailChunks[0]!;
			if (first.length <= overflow) {
				this.tailChunks.shift();
				this.tailSize -= first.length;
			} else {
				this.tailChunks[0] = first.subarray(overflow);
				this.tailSize -= overflow;
			}
		}
	}

	finalize(sessionPath?: string | null): OutputBufferResult {
		if (!this.truncated || this.totalBytes <= this.headBytes + this.tailBytes) {
			const all = Buffer.concat([...this.headChunks, ...this.tailChunks]);
			// When never truncated, tail may be empty and head holds everything.
			const content = decodeSafe(all.length ? all : Buffer.concat(this.headChunks));
			return {
				content,
				truncated: false,
				totalBytes: this.totalBytes,
				omittedBytes: 0,
				headBytes: this.headSize,
				tailBytes: 0,
			};
		}

		const head = trimToUtf8End(Buffer.concat(this.headChunks), this.headBytes);
		const tail = trimToUtf8Start(Buffer.concat(this.tailChunks), this.tailBytes);
		const omittedBytes = Math.max(0, this.totalBytes - head.length - tail.length);
		const marker = [
			"",
			`[Output truncated: kept ${head.length} head bytes + ${tail.length} tail bytes; omitted ${omittedBytes} bytes.]`,
			sessionPath
				? `Full transcript: ${sessionPath}`
				: "Full transcript remains in the child task session.",
			"",
		].join("\n");
		const content = `${decodeSafe(head)}${marker}${decodeSafe(tail)}`;
		return {
			content,
			truncated: true,
			totalBytes: this.totalBytes,
			omittedBytes,
			headBytes: head.length,
			tailBytes: tail.length,
		};
	}
}

function decodeSafe(buf: Buffer): string {
	return buf.toString("utf8");
}

/** Drop trailing incomplete UTF-8 sequence at the end of a head buffer. */
export function trimToUtf8End(buf: Buffer, maxBytes: number): Buffer {
	let end = Math.min(buf.length, maxBytes);
	while (end > 0) {
		const b = buf[end - 1]!;
		if ((b & 0xc0) !== 0x80) break; // not a continuation byte
		end--;
	}
	// If we landed on a multi-byte lead that needs more bytes than remain, drop it.
	if (end > 0) {
		const lead = buf[end - 1]!;
		const need = utf8SeqLen(lead);
		if (need > 1 && end - 1 + need > Math.min(buf.length, maxBytes)) {
			end--;
		}
	}
	return buf.subarray(0, end);
}

/** Drop leading incomplete UTF-8 continuation at the start of a tail buffer. */
export function trimToUtf8Start(buf: Buffer, maxBytes: number): Buffer {
	let start = Math.max(0, buf.length - maxBytes);
	while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
	return buf.subarray(start);
}

function utf8SeqLen(lead: number): number {
	if (lead < 0x80) return 1;
	if ((lead & 0xe0) === 0xc0) return 2;
	if ((lead & 0xf0) === 0xe0) return 3;
	if ((lead & 0xf8) === 0xf0) return 4;
	return 1;
}
