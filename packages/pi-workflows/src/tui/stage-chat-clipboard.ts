import { execFileSync } from "node:child_process";
import { platform } from "node:os";

const CLIPBOARD_IO = { timeout: 5000, stdio: ["pipe", "ignore", "ignore"] } as const;

/** Copy plain text via the host clipboard. Avoids OSC 52, which can desync the TUI. */
export function copyTextToClipboard(text: string): boolean {
	if (text.length === 0) return false;
	const os = platform();
	try {
		if (os === "darwin") {
			execFileSync("pbcopy", { input: text, ...CLIPBOARD_IO });
			return true;
		}
		if (os === "win32") {
			execFileSync("clip", { input: text, ...CLIPBOARD_IO });
			return true;
		}
		try {
			execFileSync("xclip", ["-selection", "clipboard"], { input: text, ...CLIPBOARD_IO });
			return true;
		} catch {
			execFileSync("xsel", ["--clipboard", "--input"], { input: text, ...CLIPBOARD_IO });
			return true;
		}
	} catch {
		return false;
	}
}
