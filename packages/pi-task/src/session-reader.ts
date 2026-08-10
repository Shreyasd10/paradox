/**
 * Read child session.jsonl for the conversation viewer.
 * Process-isolated children do not expose a live AgentSession; we tail the file.
 */

import * as fs from "node:fs";

export type ViewerMessage =
	| { role: "user"; text: string }
	| { role: "assistant"; text: string; tools: string[] }
	| { role: "toolResult"; text: string }
	| { role: "bash"; command: string; output?: string };

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const c of content) {
		if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
			const t = (c as { text?: string }).text;
			if (t) parts.push(t);
		}
	}
	return parts.join("\n");
}

function extractToolNames(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const names: string[] = [];
	for (const c of content) {
		if (!c || typeof c !== "object") continue;
		const t = c as { type?: string; name?: string; toolName?: string };
		if (t.type === "toolCall") names.push(t.name ?? t.toolName ?? "unknown");
	}
	return names;
}

/**
 * Parse a Pi session.jsonl into displayable messages.
 * Skips control entries (session header, model_change, etc.).
 */
export function readSessionMessages(sessionPath: string | null | undefined): ViewerMessage[] {
	if (!sessionPath || !fs.existsSync(sessionPath)) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(sessionPath, "utf-8");
	} catch {
		return [];
	}

	const out: ViewerMessage[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let entry: {
			type?: string;
			message?: { role?: string; content?: unknown; command?: string; output?: string };
		};
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}

		if (entry.type !== "message" || !entry.message) continue;
		const msg = entry.message;
		const role = msg.role;

		if (role === "user") {
			const text = extractText(msg.content);
			if (text.trim()) out.push({ role: "user", text });
		} else if (role === "assistant") {
			out.push({
				role: "assistant",
				text: extractText(msg.content),
				tools: extractToolNames(msg.content),
			});
		} else if (role === "toolResult") {
			const text = extractText(msg.content);
			if (text.trim()) out.push({ role: "toolResult", text });
		} else if (role === "bashExecution") {
			out.push({
				role: "bash",
				command: String(msg.command ?? ""),
				output: typeof msg.output === "string" ? msg.output : undefined,
			});
		}
	}
	return out;
}

/** File mtime for cheap change detection. */
export function sessionMtime(sessionPath: string | null | undefined): number {
	if (!sessionPath) return 0;
	try {
		return fs.statSync(sessionPath).mtimeMs;
	} catch {
		return 0;
	}
}
