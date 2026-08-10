/**
 * Fork context — create a new child session file branched from the parent,
 * then sanitize parent-only delegation history, control messages, and
 * unsafe provider-specific thinking blocks.
 *
 * Adapted from pi-subagents/src/shared/fork-context.ts, rewritten smaller.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

interface BranchSessionEntry {
	type: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		provider?: string;
		api?: string;
		model?: string;
	};
	thinkingLevel?: string;
	customType?: string;
}

interface ForkableSessionManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	getSessionDir?(): string;
	openSession?: (file: string, dir?: string) => BranchSessionManagerLike;
}

interface BranchSessionManagerLike {
	createBranchedSession(leafId: string): string | undefined;
	getHeader?: () => BranchSessionEntry | null;
	getEntries?: () => BranchSessionEntry[];
}

export interface ForkResolution {
	sessionFile: string;
	thinkingOverride?: "off";
}

function isUnsafeAnthropicThinkingBlock(message: BranchSessionEntry["message"], block: unknown): boolean {
	if (!message || !block || typeof block !== "object" || !("type" in block)) return false;
	const provider = typeof message.provider === "string" ? message.provider.toLowerCase() : "";
	const api = typeof message.api === "string" ? message.api.toLowerCase() : "";
	const model = typeof message.model === "string" ? message.model.toLowerCase() : "";
	const isAnthropic = provider === "anthropic" || api === "anthropic-messages" || model.startsWith("anthropic/");
	const blockType = (block as { type: string }).type;
	if (blockType === "redacted_thinking") return true;
	if (blockType !== "thinking" || !isAnthropic) return false;
	const signature =
		"thinkingSignature" in block
			? (block as { thinkingSignature: unknown }).thinkingSignature
			: "signature" in block
				? (block as { signature: unknown }).signature
				: undefined;
	return (block as { redacted?: boolean }).redacted === true || (typeof signature === "string" && signature.length > 0);
}

function isParentOnlyEntry(entry: BranchSessionEntry): boolean {
	// Remove control messages and extension delegation history
	if (entry.type === "custom" && entry.customType) {
		// Keep non-subagent custom entries; remove subagent delegation records
		if (entry.customType.startsWith("subagent") || entry.customType === "task") return true;
	}
	// Keep message entries (they are the actual conversation)
	return false;
}

function createEntryId(entries: BranchSessionEntry[]): string {
	const ids = new Set(entries.map((e) => e.id).filter((id): id is string => typeof id === "string"));
	for (let attempt = 0; attempt < 100; attempt++) {
		const id = randomUUID().slice(0, 8);
		if (!ids.has(id)) return id;
	}
	return randomUUID();
}

function appendThinkingOffEntry(entries: BranchSessionEntry[]): void {
	const last = entries[entries.length - 1];
	if (last?.type === "thinking_level_change" && last.thinkingLevel === "off") return;
	const parent = [...entries].reverse().find((e) => typeof e.id === "string");
	entries.push({
		type: "thinking_level_change",
		id: createEntryId(entries),
		parentId: parent?.id ?? null,
		timestamp: new Date().toISOString(),
		thinkingLevel: "off",
	});
}

function sanitizeEntries(entries: BranchSessionEntry[]): boolean {
	let sanitized = false;

	// Remove parent-only entries
	const filtered = entries.filter((e) => {
		if (isParentOnlyEntry(e)) {
			sanitized = true;
			return false;
		}
		return true;
	});

	// Sanitize unsafe thinking blocks
	for (const entry of filtered) {
		if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
		const content = entry.message.content.filter(
			(block) => !isUnsafeAnthropicThinkingBlock(entry.message, block),
		);
		if (content.length !== entry.message.content.length) {
			entry.message.content = content;
			sanitized = true;
		}
	}

	if (sanitized) appendThinkingOffEntry(filtered);

	// Replace entries array in place
	entries.length = 0;
	entries.push(...filtered);

	return sanitized;
}

function readSessionEntries(sessionFile: string): BranchSessionEntry[] {
	const lines = fs
		.readFileSync(sessionFile, "utf-8")
		.split("\n")
		.filter((line) => line.trim().length > 0);
	return lines.map((line, index) => {
		try {
			return JSON.parse(line) as BranchSessionEntry;
		} catch (error) {
			const cause = error instanceof Error ? error : new Error(String(error));
			throw new Error(
				`Unable to inspect forked session ${sessionFile}: invalid JSONL on line ${index + 1}: ${cause.message}`,
				{ cause },
			);
		}
	});
}

/**
 * Create a forked child session from the parent session manager.
 * Returns the path to the new child session file, or throws on failure.
 */
export function createForkSession(
	sessionManager: ForkableSessionManager,
): ForkResolution {
	const parentSessionFile = sessionManager.getSessionFile();
	if (!parentSessionFile) {
		throw new Error("Fork context requires a persisted parent session.");
	}

	const leafId = sessionManager.getLeafId();
	if (!leafId) {
		throw new Error("Fork context requires a current leaf to fork from.");
	}

	if (!fs.existsSync(parentSessionFile)) {
		throw new Error(
			`Parent session file does not exist: ${parentSessionFile}. Pi has not persisted enough history to fork yet.`,
		);
	}

	const openSession =
		sessionManager.openSession ??
		((file: string, dir?: string) => SessionManager.open(file, dir) as unknown as BranchSessionManagerLike);
	const sessionDir = sessionManager.getSessionDir?.();
	const sourceManager = openSession(parentSessionFile, sessionDir);
	const sessionFile = sourceManager.createBranchedSession(leafId);
	if (!sessionFile) {
		throw new Error("Session manager did not return a forked session file.");
	}

	let thinkingOverride: "off" | undefined;

	if (!fs.existsSync(sessionFile)) {
		// Session manager returned a path but hasn't written it yet — write manually
		const header = sourceManager.getHeader?.();
		const entries = sourceManager.getEntries?.();
		if (!header || !entries) {
			throw new Error(
				`Session manager returned a forked session file that does not exist and cannot be persisted: ${sessionFile}`,
			);
		}
		if (sanitizeEntries(entries)) thinkingOverride = "off";
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		fs.writeFileSync(
			sessionFile,
			`${[header, ...entries].map((e) => JSON.stringify(e)).join("\n")}\n`,
			"utf-8",
		);
	} else {
		const entries = readSessionEntries(sessionFile);
		if (sanitizeEntries(entries)) {
			thinkingOverride = "off";
			fs.writeFileSync(sessionFile, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf-8");
		}
	}

	return { sessionFile, ...(thinkingOverride ? { thinkingOverride } : {}) };
}
