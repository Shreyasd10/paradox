/** Last visible assistant text from a stage-chat transcript. No TUI imports. */

export function lastAssistantText(entries: readonly unknown[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry == null || typeof entry !== "object") continue;
		const rec = entry as {
			kind?: unknown;
			role?: unknown;
			message?: { content?: unknown };
		};
		if (rec.role === "notice" || rec.kind !== "assistant") continue;
		const text = extractPlainText(rec.message?.content).trim();
		if (text.length > 0) return text;
	}
	return undefined;
}

function extractPlainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const item of content) {
		if (item == null) continue;
		if (typeof item === "string") {
			parts.push(item);
			continue;
		}
		const obj = item as { text?: unknown };
		if (typeof obj.text === "string") parts.push(obj.text);
	}
	return parts.join("");
}
