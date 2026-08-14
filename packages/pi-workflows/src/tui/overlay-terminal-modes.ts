/**
 * Terminal-mode seams for the workflow graph overlay: raw mouse-scroll
 * reporting and autowrap (DECAWM) escape sequences for the local TTY, plus
 * extraction of the isolated host's remote terminal-control capability.
 *
 * cross-ref: src/tui/overlay-adapter.ts, src/tui/stage-chat-view-state.ts
 */

import type { PiCustomOverlayFactoryTui, PiRemoteTerminalControl } from "../extension/wiring.js";

const MOUSE_SCROLL_TRACKING_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const MOUSE_SCROLL_TRACKING_OFF = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
const TERMINAL_AUTOWRAP_ON = "\x1b[?7h";
const TERMINAL_AUTOWRAP_OFF = "\x1b[?7l";

/** Cursor/VS Code integrated terminals already own mouse selection and copy. */
export function isEmbeddedIdeTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
	const program = (env.TERM_PROGRAM ?? "").toLowerCase();
	return (
		program === "vscode" ||
		program === "cursor" ||
		!!env.VSCODE_INJECTION ||
		!!env.VSCODE_PID ||
		!!env.CURSOR_TRACE_ID
	);
}

/** Always capture the wheel. Native select in a fullscreen overlay copies chrome and can freeze the IDE selection. */
export function defaultStageChatMouseScrollCapture(_env?: NodeJS.ProcessEnv): boolean {
	return true;
}

export interface OverlayTerminalOutput {
	platform: NodeJS.Platform;
	isTTY: boolean | undefined;
	write(data: string): void;
}

export function setMouseScrollTracking(enabled: boolean, output: OverlayTerminalOutput): void {
	if (!output.isTTY) return;
	output.write(enabled ? MOUSE_SCROLL_TRACKING_ON : MOUSE_SCROLL_TRACKING_OFF);
}

export function setTerminalAutowrap(enabled: boolean, output: OverlayTerminalOutput): void {
	if (output.platform !== "win32" || !output.isTTY) return;
	output.write(enabled ? TERMINAL_AUTOWRAP_ON : TERMINAL_AUTOWRAP_OFF);
}

/**
 * Extract the host's remote terminal-control capability from the factory TUI —
 * present in isolated interactive mode (drives the real host TTY over the
 * allowlisted engine protocol); `null` for non-isolated hosts and test seams.
 */
export function remoteTerminalControlFrom(tui: PiCustomOverlayFactoryTui): PiRemoteTerminalControl | null {
	const terminal = tui.terminal;
	if (
		terminal === undefined ||
		typeof terminal.setMouseScrollTracking !== "function" ||
		typeof terminal.setAutowrap !== "function"
	) {
		return null;
	}
	return {
		setMouseScrollTracking: terminal.setMouseScrollTracking.bind(terminal),
		setAutowrap: terminal.setAutowrap.bind(terminal),
	};
}
